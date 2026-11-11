// Saving and loading: flows, the trash, backups and restore.
// These run against a real IndexedDB implementation (fake-indexeddb), so they
// exercise the same code path the app uses.
import { beforeEach, describe, expect, it } from 'vitest';
import { addChild, addRoot, layoutSheet, updateCell } from '../../src/core/flow/model';
import { backupsToPrune, describeSnapshot, parseSnapshot } from '../../src/core/backup/backup';
import { DEFAULT_TOPIC_ID } from '../../src/core/debate/topics';
import { MemoryBackend, openBackend } from '../../src/data/db';
import {
  backups,
  closeStoreForTests,
  currentSnapshot,
  db,
  flushWrites,
  initStore,
  journalPendingWrites,
  readBackup,
  restoreFromTrash,
  restoreSnapshot,
  saveState,
  settings,
  storageKind,
  takeBackup,
  trash,
  updateSettings,
} from '../../src/data/store';
import { resetLockForTests, lockState, isAiLocked as isAiLockedNow } from '../../src/ai/lock';
import { endRound, startRound } from '../../src/features/round/roundService';
import { toggleSpeech, remaining } from '../../src/core/timer/timer';
import type { Round } from '../../src/data/schema';

let dbCounter = 0;
let dbName = '';

/** Open a brand-new database (as on first run). */
async function freshStore() {
  closeStoreForTests();
  resetLockForTests();
  dbName = `test-${++dbCounter}-${Math.random().toString(36).slice(2)}`;
  await initStore(await openBackend(dbName));
}

/** Close the app and open it again on the same database (as after a restart or crash). */
async function reopen() {
  await flushWrites();
  closeStoreForTests();
  // The lock's in-memory state is lost on restart, like everything else in memory.
  lockState.value = null;
  await initStore(await openBackend(dbName));
}

const meta = { tournament: 'State', roundNumber: '3', side: 'neg' as const, opponent: 'Lincoln AB', judge: 'Kim', room: '204' };

async function roundWithFlow(): Promise<Round> {
  const round = await startRound({ name: '', meta, practice: false, formatId: 'nsda-hs', mergeBlock: false });
  let sheet = round.sheets[0];
  const adv = addRoot(sheet, 0, null, 'Adv 1: access');
  sheet = adv.sheet;
  const ans = addChild(sheet, adv.id, 'answer', 'No solvency — é “quotes” 🎯')!;
  sheet = updateCell(ans.sheet, ans.id, { turn: true });
  const ext = addChild(sheet, adv.id, 'extend', 'Extend adv 1')!;
  sheet = updateCell(ext.sheet, ext.id, { dropped: true });
  return db.rounds.put({ ...round, sheets: [sheet], cxNotes: { '1AC': 'Asked about funding.' } }, 250);
}

beforeEach(freshStore);

describe('first run', () => {
  it('uses IndexedDB and seeds the default topic with the exact resolution', () => {
    expect(storageKind.value).toBe('indexeddb');
    const topic = db.topics.get(DEFAULT_TOPIC_ID)!;
    expect(topic.resolution).toBe('Resolved: The United States federal government should establish national health insurance in the United States.');
    expect(topic.noviceLimits.map((n) => n.name)).toEqual([
      'Medicare for All',
      'Revise/Expand the Affordable Care Act',
      'Single Payer Option to Replace Private Health Insurance',
    ]);
    expect(settings.value.activeTopicId).toBe(DEFAULT_TOPIC_ID);
  });

  it('does not add the topic twice', async () => {
    await reopen();
    await reopen();
    expect(db.topics.list.value).toHaveLength(1);
  });
});

describe('flows are saved and loaded exactly', () => {
  it('a flow survives closing and reopening the app', async () => {
    const before = await roundWithFlow();
    await reopen();
    const after = db.rounds.get(before.id)!;
    expect(after.sheets).toEqual(before.sheets);
    expect(after.cxNotes).toEqual({ '1AC': 'Asked about funding.' });
    expect(after.meta).toEqual(meta);
    expect(after.name).toBe('State R3 Neg vs Lincoln AB');
    expect(after.format.prep).toBe(480);
    // The layout of the loaded flow is identical too.
    expect(layoutSheet(after.sheets[0])).toEqual(layoutSheet(before.sheets[0]));
  });

  it('typing is saved even when the app closes before the autosave delay has passed', async () => {
    const round = await roundWithFlow();
    // A change with a long delay, then an immediate "window closing" flush.
    db.rounds.put({ ...round, reviewNotes: 'typed a moment ago' }, 60_000);
    expect(saveState.value.pending).toBeGreaterThan(0);
    await reopen();
    expect(db.rounds.get(round.id)!.reviewNotes).toBe('typed a moment ago');
    expect(saveState.value.pending).toBe(0);
  });

  it('a delayed save always writes the newest version', async () => {
    const round = await roundWithFlow();
    for (let i = 0; i < 20; i++) db.rounds.put({ ...db.rounds.get(round.id)!, reviewNotes: `v${i}` }, 50);
    await reopen();
    expect(db.rounds.get(round.id)!.reviewNotes).toBe('v19');
  });

  it('a running timer keeps the right time across a restart', async () => {
    const round = await roundWithFlow();
    const t0 = 1_800_000_000_000;
    db.rounds.put({ ...round, clock: toggleSpeech(round.clock, t0) });
    await reopen();
    const clock = db.rounds.get(round.id)!.clock;
    expect(clock.speech.running).toBe(true);
    expect(remaining(clock.speech, t0 + 125_000)).toBe(8 * 60_000 - 125_000);
  });

  it('a damaged flow in the database is repaired on load instead of breaking the app', async () => {
    const round = await roundWithFlow();
    await flushWrites();
    const raw = await openBackend(dbName);
    const stored = (await raw.get<Round>('rounds', round.id))!;
    const cellId = Object.keys(stored.sheets[0].cells)[0];
    stored.sheets[0].cells[cellId].kids.push('missing-cell');
    (stored as unknown as { cxNotes: unknown }).cxNotes = null;
    await raw.put('rounds', stored);
    raw.close();
    await reopen();
    const loaded = db.rounds.get(round.id)!;
    expect(loaded.sheets[0].cells[cellId].kids).not.toContain('missing-cell');
    expect(loaded.cxNotes).toEqual({});
    expect(Object.keys(layoutSheet(loaded.sheets[0]).pos)).toHaveLength(Object.keys(loaded.sheets[0].cells).length);
  });
});

describe('autosave timing and the crash journal', () => {
  it('non-stop typing is still written within a second (no endless postponing)', async () => {
    const round = await roundWithFlow();
    await flushWrites();
    // 40 changes, 50 ms apart, each asking to wait 250 ms for more typing.
    for (let i = 0; i < 40; i++) {
      db.rounds.put({ ...db.rounds.get(round.id)!, reviewNotes: `typing ${i}` }, 250);
      await new Promise((r) => setTimeout(r, 50));
      if (i === 25) {
        // 1.3 s in: the database must already hold something recent, although the typing never paused.
        const raw = await openBackend(dbName);
        const onDisk = (await raw.get<Round>('rounds', round.id))!.reviewNotes;
        raw.close();
        expect(onDisk).toMatch(/^typing \d+$/);
        expect(Number(onDisk.split(' ')[1])).toBeGreaterThan(5);
      }
    }
  });

  it('changes that never reached the database are recovered from the journal', async () => {
    const round = await roundWithFlow();
    await flushWrites();
    // A change is made, and the window closes before the database write happens.
    db.rounds.put({ ...db.rounds.get(round.id)!, reviewNotes: 'last words before the crash' }, 500);
    updateSettings({ initials: 'JR' });
    journalPendingWrites();
    // Simulate the crash: drop everything in memory WITHOUT flushing.
    closeStoreForTests();
    lockState.value = null;
    await initStore(await openBackend(dbName));
    expect(db.rounds.get(round.id)!.reviewNotes).toBe('last words before the crash');
    expect(settings.value.initials).toBe('JR');
    expect(localStorage.getItem('policy-debate.journal')).toBeNull();
  });

  it('a write that had started but not finished when the window closed is recovered too', async () => {
    closeStoreForTests();
    resetLockForTests();
    // A database whose writes never finish, like a page being torn down mid-save.
    const slow = new MemoryBackend();
    await initStore(slow);
    await flushWrites();
    const realPut = slow.put.bind(slow);
    slow.put = () => new Promise<void>(() => {});
    updateSettings({ initials: 'QQ' });
    await new Promise((r) => setTimeout(r, 300)); // the timer has fired; the write is "in flight" and stuck
    journalPendingWrites();
    expect(localStorage.getItem('policy-debate.journal')).toContain('QQ');
    // Next start: the journal is replayed into the database.
    slow.put = realPut;
    closeStoreForTests();
    lockState.value = null;
    await initStore(slow);
    expect(settings.value.initials).toBe('QQ');
  });

  it('once a write is confirmed it leaves the journal', async () => {
    updateSettings({ initials: 'OK' });
    await flushWrites();
    journalPendingWrites();
    expect(localStorage.getItem('policy-debate.journal')).toBeNull();
  });

  it('a stale journal never overwrites newer saved data, and junk in it is ignored', async () => {
    const round = await roundWithFlow();
    await flushWrites();
    const old = { ...db.rounds.get(round.id)!, reviewNotes: 'old', updatedAt: 1 };
    localStorage.setItem('policy-debate.journal', JSON.stringify([{ store: 'rounds', doc: old }, null, { store: 'evil', doc: { id: 'x' } }, { store: 'meta', doc: { id: 'roundLock', active: false } }]));
    await reopen();
    expect(db.rounds.get(round.id)!.reviewNotes).toBe('');
    expect(isAiLockedNow()).toBe(true); // the journal cannot switch the round lock off
    localStorage.setItem('policy-debate.journal', '{not json');
    await reopen();
    expect(db.rounds.get(round.id)).toBeDefined();
  });
});

describe('settings', () => {
  it('are saved, and new options get defaults', async () => {
    updateSettings((s) => ({ ...s, initials: 'AB', timer: { ...s.timer, warningSec: 45 } }));
    await reopen();
    expect(settings.value.initials).toBe('AB');
    expect(settings.value.timer.warningSec).toBe(45);
    expect(settings.value.highlight.affWord).toBe('cyan'); // untouched default
    expect(settings.value.highlight.negColor).toBe('#ff9e9e');
  });
});

describe('trash', () => {
  it('deleted rounds can be restored, even after a restart', async () => {
    const round = await roundWithFlow();
    await endRound();
    db.rounds.remove(round.id, 'Round: test');
    expect(db.rounds.get(round.id)).toBeUndefined();
    await reopen();
    expect(db.rounds.get(round.id)).toBeUndefined();
    expect(trash.value).toHaveLength(1);
    expect(restoreFromTrash(trash.value[0].id)).toBe(true);
    await reopen();
    expect(db.rounds.get(round.id)!.sheets).toEqual(round.sheets);
    expect(trash.value).toHaveLength(0);
  });
});

describe('backups', () => {
  it('a backup file restores everything into an empty app', async () => {
    const round = await roundWithFlow();
    await endRound();
    updateSettings({ initials: 'AB' });
    const json = JSON.stringify(currentSnapshot());

    await freshStore(); // a different computer
    expect(db.rounds.list.value).toHaveLength(0);
    const parsed = parseSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(describeSnapshot(parsed.snapshot)).toBe('1 topic, 1 round');
    await restoreSnapshot(parsed.snapshot);
    await reopen();
    expect(db.rounds.get(round.id)!.sheets).toEqual(round.sheets);
    expect(db.rounds.get(round.id)!.sheets[0].roots).toEqual(round.sheets[0].roots);
    expect(settings.value.initials).toBe('AB');
  });

  it('takes a safety snapshot before restoring, so a restore can be undone', async () => {
    const round = await roundWithFlow();
    await endRound();
    const empty = parseSnapshot(JSON.stringify({ app: 'policy-debate', schema: 1, data: {} }));
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    await restoreSnapshot(empty.snapshot);
    expect(db.rounds.list.value).toHaveLength(0);
    expect(db.topics.list.value).toHaveLength(1); // never left without a topic
    const safety = backups.value.find((b) => b.reason === 'Before restoring a backup')!;
    const back = parseSnapshot((await readBackup(safety.id))!);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    await restoreSnapshot(back.snapshot);
    expect(db.rounds.get(round.id)!.sheets).toEqual(round.sheets);
  });

  it('skips automatic snapshots when nothing changed', async () => {
    await flushWrites();
    expect(await takeBackup('Automatic', true)).toBe(true);
    expect(await takeBackup('Automatic')).toBe(false);
    updateSettings({ initials: 'AB' });
    expect(await takeBackup('Automatic')).toBe(true);
  });

  it('rejects files that are not backups, without changing anything', () => {
    expect(parseSnapshot('not json')).toEqual({ ok: false, error: expect.stringContaining('not valid JSON') });
    expect(parseSnapshot('{"hello":1}').ok).toBe(false);
    expect(parseSnapshot('null').ok).toBe(false);
    expect(parseSnapshot(JSON.stringify({ app: 'policy-debate', schema: 1 })).ok).toBe(false);
    const future = parseSnapshot(JSON.stringify({ app: 'policy-debate', schema: 999, data: {} }));
    expect(future).toEqual({ ok: false, error: expect.stringContaining('newer version') });
  });

  it('skips damaged items but keeps the good ones', () => {
    const parsed = parseSnapshot(
      JSON.stringify({
        app: 'policy-debate',
        schema: 1,
        data: { cards: [{ id: 'a', text: 'x' }, null, { nope: true }, { id: 'a', text: 'x' }, { id: 'b', text: 'y', createdAt: 'x' }, { id: 'no-text' }], rounds: 'oops' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.data.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(parsed.snapshot.data.cards[1].createdAt).toBe(0);
    expect(parsed.snapshot.data.rounds).toEqual([]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it('keeps the newest ten snapshots plus one per day', () => {
    const day = 24 * 3600 * 1000;
    const base = new Date(2026, 10, 10, 12).getTime();
    // 30 snapshots today (a minute apart), then one a day for 20 days before.
    const list = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `today-${i}`, createdAt: base - i * 60_000 })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `day-${i + 1}`, createdAt: base - (i + 1) * day })),
    ];
    const pruned = new Set(backupsToPrune(list));
    const kept = list.filter((b) => !pruned.has(b.id)).map((b) => b.id);
    expect(kept.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `today-${i}`));
    expect(kept).toContain('day-1');
    expect(kept).toContain('day-13');
    expect(kept).not.toContain('day-14');
    expect(kept).not.toContain('today-10');
    expect(kept).toHaveLength(10 + 13);
  });
});

describe('when the browser will not let us save', () => {
  it('falls back to memory and says so', async () => {
    closeStoreForTests();
    resetLockForTests();
    await initStore(new MemoryBackend());
    expect(storageKind.value).toBe('memory');
    await roundWithFlow();
    await flushWrites();
    expect(saveState.value.error).toBeNull();
  });

  it('reports a failed write instead of hiding it', async () => {
    closeStoreForTests();
    resetLockForTests();
    const backend = new MemoryBackend();
    await initStore(backend);
    backend.put = async () => {
      throw new Error('disk full');
    };
    updateSettings({ initials: 'XX' });
    await flushWrites();
    expect(saveState.value).toMatchObject({ error: expect.stringContaining('disk full') });
  });
});
