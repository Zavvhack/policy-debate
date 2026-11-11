// DATA SAFETY
// -----------
// Things that must hold so that nobody loses work or gets a blank screen:
// old or damaged files are repaired (never "fixed" in a way that changes
// evidence), the app refuses to write into files from a newer version, undo on
// the flow never throws typing away, and a second open window cannot use AI
// during a round.
import { beforeEach, describe, expect, it } from 'vitest';
import { askClaude, setAiTransportForTests } from '../../src/ai/client';
import { engageLock, initLock, isAiLocked, lockState, resetLockForTests, watchOtherWindows } from '../../src/ai/lock';
import { backupsToPrune, parseSnapshot } from '../../src/core/backup/backup';
import { repairDoc, repairRound } from '../../src/core/backup/repair';
import { mergeSettings } from '../../src/core/debate/topics';
import { addChild, addRoot, removeCell, restoreStructure, updateCell, createSheet } from '../../src/core/flow/model';
import { remaining } from '../../src/core/timer/timer';
import { MemoryBackend, openBackend } from '../../src/data/db';
import { closeStoreForTests, db, flushWrites, initStore, journalPendingWrites, storeReady } from '../../src/data/store';
import type { Card, Round } from '../../src/data/schema';

const MIRROR = 'policy-debate.roundLock';

describe('old or damaged files are repaired before a screen sees them', () => {
  it('a card keeps its exact text; only what is missing around it is filled in', () => {
    const text = 'Coverage “gaps” persist — naïve models miss this.\n\nSecond paragraph.';
    const card = repairDoc('cards', { id: 'c1', text }) as Card;
    expect(card.text).toBe(text);
    expect(card.marks).toEqual([]);
    expect(card.tag).toEqual([]);
    expect(card.labels).toEqual([]);
    expect(card.cite.last).toBe('');
    expect(card.citeUnverified).toEqual([]);
    expect(card.source).toBeNull();
  });

  it('highlight marks that point outside the text are dropped; the text is untouched', () => {
    const text = 'abcdefghij';
    const card = repairDoc('cards', {
      id: 'c1',
      text,
      marks: [{ s: 0, e: 4, lv: 2 }, { s: 8, e: 99, lv: 1 }, { s: 5, e: 3, lv: 1 }, { s: 1.5, e: 3, lv: 1 }, { s: 2, e: 6, lv: 7 }, 'junk', null],
    }) as Card;
    expect(card.text).toBe(text);
    expect(card.marks).toEqual([{ s: 0, e: 4, lv: 2 }]);
  });

  it('a card or source whose text is not text is dropped, never invented', () => {
    expect(repairDoc('cards', { id: 'c1' })).toBeNull();
    expect(repairDoc('cards', { id: 'c1', text: 42 })).toBeNull();
    expect(repairDoc('sources', { id: 's1', text: null })).toBeNull();
    expect(repairDoc('cards', { text: 'no id' })).toBeNull();
  });

  it('every kind of document survives being almost empty', () => {
    for (const name of ['topics', 'blocks', 'templates', 'tfiles', 'rounds', 'drills'] as const) {
      const doc = repairDoc(name, { id: 'x' });
      expect(doc, name).not.toBeNull();
      expect(doc!.id).toBe('x');
    }
    expect(repairDoc('scouting', { id: 'x', type: 'judge' })).toMatchObject({ name: '', preferences: '' });
    expect(repairDoc('scouting', { id: 'x', type: 'something else' })).toBeNull();
  });

  it('a round with a broken clock gets a working one, in the right time format', () => {
    const round = repairRound({ id: 'r1', clock: 'broken', sheets: [{ id: 's', cells: { a: { text: 'kept' } } }] } as unknown as Round);
    expect(round.clock.stepIndex).toBe(0);
    expect(remaining(round.clock.speech, 0)).toBe(8 * 60 * 1000);
    expect(round.clock.prep.aff.running).toBe(false);
    expect(round.sheets[0].cells.a.text).toBe('kept');
    expect(round.meta.side).toBe('neg');
    expect(round.cxNotes).toEqual({});
  });

  it('a timer saved as "running" with no start time is treated as paused, not as NaN', () => {
    const round = repairRound({
      id: 'r1',
      clock: { stepIndex: 99, speech: { durationMs: 1000, remainingMs: 400, running: true, startedAt: null }, prep: {} },
    } as unknown as Round);
    expect(round.clock.speech.running).toBe(false);
    expect(remaining(round.clock.speech, Date.now())).toBe(400);
    expect(round.clock.stepIndex).toBe(11);
  });

  it('a good round passes through unchanged', async () => {
    closeStoreForTests();
    resetLockForTests();
    await initStore(await openBackend(`safety-${Math.random()}`));
    const { startRound } = await import('../../src/features/round/roundService');
    const round = await startRound({ name: 'R', meta: { tournament: '', roundNumber: '', side: 'aff', opponent: '', judge: '', room: '' }, practice: true, formatId: 'nsda-hs', mergeBlock: false });
    expect(repairRound(structuredClone(round))).toEqual(round);
  });

  it('garbage in saved settings falls back to the defaults', () => {
    const s = mergeSettings({ theme: 'neon', textScale: 'big', highlight: { negColor: 'red; }', unreadPt: 900 }, timer: { customFormats: 'x', warningSec: -5 }, flow: { abbreviations: [null, { code: 'a', expansion: 'b' }], fontPx: null } });
    expect(s.theme).toBe('system');
    expect(s.textScale).toBe(1);
    expect(s.highlight.negColor).toBe('#ff9e9e');
    expect(s.highlight.unreadPt).toBe(14);
    expect(s.timer.customFormats).toEqual([]);
    expect(s.timer.warningSec).toBe(0);
    expect(s.flow.abbreviations).toEqual([{ code: 'a', expansion: 'b' }]);
    expect(s.flow.fontPx).toBe(14);
  });

  it('a backup file with half-empty documents restores to something every screen can draw', () => {
    const parsed = parseSnapshot(JSON.stringify({ app: 'policy-debate', schema: 1, data: { cards: [{ id: 'a', text: 'T' }], blocks: [{ id: 'b', items: 'x' }], tfiles: [{ id: 't', sections: [{ id: 's' }, 7] }] } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.data.blocks[0].items).toEqual([]);
    expect(parsed.snapshot.data.tfiles[0].sections).toHaveLength(1);
    expect(parsed.snapshot.data.tfiles[0].sections[0].on).toBe(true);
  });
});

describe('files from a newer version are never written into', () => {
  it('refuses to open, and changes nothing', async () => {
    closeStoreForTests();
    resetLockForTests();
    const backend = new MemoryBackend();
    await backend.put('meta', { id: 'format', version: 99 });
    await backend.put('cards', { id: 'future', text: 'x', somethingNew: true });
    await expect(initStore(backend)).rejects.toThrow(/newer version/);
    expect(storeReady.value).toBe(false);
    expect(await backend.getAll('cards')).toEqual([{ id: 'future', text: 'x', somethingNew: true }]);
    expect(await backend.getAll('topics')).toEqual([]);
    // AI stays off: the lock never loaded.
    expect(isAiLocked()).toBe(true);
  });

  it('records the format it writes, so a later version can tell', async () => {
    closeStoreForTests();
    resetLockForTests();
    const backend = new MemoryBackend();
    await initStore(backend);
    expect(await backend.get('meta', 'format')).toEqual({ id: 'format', version: 1 });
  });
});

describe('the crash journal', () => {
  it('is not wiped by a window that closes before its files have loaded', () => {
    closeStoreForTests(); // storeReady = false, as during start-up
    localStorage.setItem('policy-debate.journal', '[{"store":"cards","doc":{"id":"x","text":"unsaved"}}]');
    journalPendingWrites();
    expect(localStorage.getItem('policy-debate.journal')).toContain('unsaved');
    localStorage.removeItem('policy-debate.journal');
  });
});

describe('automatic snapshots cannot fill the disk', () => {
  it('drops the oldest once the kept ones pass the size budget, but always keeps three', () => {
    const MB = 1024 * 1024;
    const list = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, createdAt: 1_000_000 - i * 1000, bytes: 60 * MB }));
    const gone = backupsToPrune(list);
    expect(gone).toEqual(['b3', 'b4', 'b5', 'b6', 'b7']);
    // Small libraries are not affected.
    expect(backupsToPrune(list.map((b) => ({ ...b, bytes: 1 * MB })))).toEqual([]);
  });
});

describe('flow undo never throws typing away', () => {
  const build = () => {
    let sheet = createSheet('Case', 'case', false);
    const a = addRoot(sheet, 0, null, 'Adv 1');
    sheet = a.sheet;
    const b = addChild(sheet, a.id, 'answer', 'No link')!;
    return { sheet: b.sheet, a: a.id, b: b.id };
  };

  it('undoing a delete brings the cell back and keeps words typed since', () => {
    const { sheet, a, b } = build();
    const before = sheet;
    let now = removeCell(sheet, b, true); // deleted by mistake
    now = updateCell(now, a, { text: 'Adv 1: access — typed after the delete' });
    const undone = restoreStructure(before, now);
    expect(undone.cells[b].text).toBe('No link');
    expect(undone.cells[a].text).toBe('Adv 1: access — typed after the delete');
    expect(undone.cells[a].kids).toEqual([b]);
  });

  it('undoing a mark keeps the words but removes the mark', () => {
    const { sheet, a } = build();
    const before = sheet;
    let now = updateCell(sheet, a, { dropped: true });
    now = updateCell(now, a, { text: 'changed' });
    const undone = restoreStructure(before, now);
    expect(undone.cells[a].dropped).toBeUndefined();
    expect(undone.cells[a].text).toBe('changed');
  });

  it('redo brings back a cell that undo removed, words included', () => {
    const { sheet, a } = build();
    const before = sheet; // undo target
    const added = addChild(sheet, a, 'answer', '')!;
    const typed = updateCell(added.sheet, added.id, { text: 'three minutes of typing' });
    const undone = restoreStructure(before, typed); // Alt+Z: the new cell goes
    expect(undone.cells[added.id]).toBeUndefined();
    const redone = restoreStructure(typed, undone); // Alt+Shift+Z: it comes back
    expect(redone.cells[added.id].text).toBe('three minutes of typing');
  });
});

describe('a second open window cannot use AI during a round', () => {
  beforeEach(() => {
    resetLockForTests();
    setAiTransportForTests(null);
  });

  it('a round started in another window locks this one at once, with no reload', async () => {
    initLock(null, async () => {});
    expect(isAiLocked()).toBe(false);
    // The other window writes the shared mirror when its round starts.
    localStorage.setItem(MIRROR, JSON.stringify({ active: true, roundId: 'r-other', since: 1 }));
    expect(isAiLocked()).toBe(true);
    let called = false;
    setAiTransportForTests(async () => {
      called = true;
      return new Response('{}');
    });
    await expect(askClaude({ task: 'test', tier: 'fast', system: 's', user: 'p', maxTokens: 10 })).rejects.toMatchObject({ kind: 'locked' });
    expect(called).toBe(false);
  });

  it('the storage event switches this window into Round Mode', () => {
    initLock(null, async () => {});
    const stop = watchOtherWindows(async () => null);
    localStorage.setItem(MIRROR, JSON.stringify({ active: true, roundId: 'r-other', since: 1 }));
    window.dispatchEvent(new StorageEvent('storage', { key: MIRROR }));
    expect(lockState.value).toMatchObject({ active: true, roundId: 'r-other' });
    stop();
  });

  it('a round ended elsewhere unlocks here only when the database copy agrees', async () => {
    initLock(null, async () => {});
    await engageLock('r1', 1);
    let saved: { active: boolean } = { active: true };
    const stop = watchOtherWindows(async () => saved);
    // Mirror cleared, database still says a round is on: stay locked.
    localStorage.setItem(MIRROR, JSON.stringify({ active: false, roundId: null, since: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: MIRROR }));
    await new Promise((r) => setTimeout(r, 20));
    expect(lockState.value?.active).toBe(true);
    // Both copies now say the round is over.
    saved = { active: false };
    window.dispatchEvent(new StorageEvent('storage', { key: MIRROR }));
    await new Promise((r) => setTimeout(r, 20));
    expect(lockState.value?.active).toBe(false);
    stop();
  });

  it('wiping localStorage in another window cannot unlock this one', async () => {
    initLock(null, async () => {});
    await engageLock('r1', 1);
    const stop = watchOtherWindows(async () => ({ active: true }));
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(isAiLocked()).toBe(true);
    stop();
  });
});

// Keep the store closed for whichever test file runs next in this worker.
describe('cleanup', () => {
  it('closes the store', async () => {
    await flushWrites();
    closeStoreForTests();
    expect(db.cards.list.value).toBeDefined();
  });
});
