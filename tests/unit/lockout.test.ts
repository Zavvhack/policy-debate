// THE ROUND MODE LOCKOUT
// ----------------------
// "No AI during a round, ever" - these tests are the proof.
//
// Part 1 checks the lock itself: it fails closed, survives restarts, and only
//        "End round" releases it.
// Part 2 checks the code's structure: there is exactly one door to the AI
//        service, and Round Mode's code never walks through it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AiLockedError,
  assertAiAllowed,
  engageLock,
  initLock,
  isAiLocked,
  lockState,
  releaseLock,
  resetLockForTests,
  type LockState,
} from '../../src/ai/lock';
import { openBackend } from '../../src/data/db';
import { closeStoreForTests, db, flushWrites, initStore } from '../../src/data/store';
import { activeRound, endRound, startRound } from '../../src/features/round/roundService';

const meta = { tournament: 'T', roundNumber: '1', side: 'aff' as const, opponent: '', judge: '', room: '' };
const start = () => startRound({ name: 'Test', meta, practice: false, formatId: 'nsda-hs', mergeBlock: false });

let dbName = '';
async function freshStore() {
  closeStoreForTests();
  resetLockForTests();
  dbName = `lock-${Math.random().toString(36).slice(2)}`;
  await initStore(await openBackend(dbName));
}
async function restartApp() {
  await flushWrites();
  closeStoreForTests();
  lockState.value = null; // memory is wiped by a restart
  await initStore(await openBackend(dbName));
}

describe('the lock', () => {
  beforeEach(() => resetLockForTests());

  it('is ON before anything has loaded (fails closed)', () => {
    expect(lockState.value).toBeNull();
    expect(isAiLocked()).toBe(true);
    expect(() => assertAiAllowed()).toThrow(AiLockedError);
  });

  it('is off once loaded with no round in progress', () => {
    initLock(undefined, async () => {});
    expect(isAiLocked()).toBe(false);
    expect(() => assertAiAllowed()).not.toThrow();
  });

  it('locks immediately, before the save has finished', async () => {
    initLock(undefined, async () => {});
    let finishSave = () => {};
    initLock(undefined, () => new Promise<void>((resolve) => (finishSave = resolve)));
    const pending = engageLock('round-1', 123);
    expect(isAiLocked()).toBe(true); // already locked while the save is still in flight
    finishSave();
    await pending;
    expect(lockState.value).toEqual({ active: true, roundId: 'round-1', since: 123 });
  });

  it('stays locked even if saving the lock fails', async () => {
    initLock(undefined, async () => {
      throw new Error('disk full');
    });
    await expect(engageLock('round-1', 1)).rejects.toThrow('disk full');
    expect(isAiLocked()).toBe(true);
  });

  it('if EITHER saved copy says a round is active, it is active', () => {
    // Database says active, mirror is empty.
    initLock({ active: true, roundId: 'r', since: 5 }, async () => {});
    expect(isAiLocked()).toBe(true);
    // Database says inactive, but the mirror (written above) still says active.
    lockState.value = null;
    initLock({ active: false, roundId: null, since: null }, async () => {});
    expect(isAiLocked()).toBe(true);
    expect((lockState.value as LockState | null)?.roundId).toBe('r');
  });

  it('garbage in the saved copies cannot unlock anything', () => {
    localStorage.setItem('policy-debate.roundLock', '{not json');
    initLock({ active: 'yes' } as unknown as LockState, async () => {});
    expect(isAiLocked()).toBe(false); // nothing valid says "active", and that is the unlocked default...
    resetLockForTests();
    localStorage.setItem('policy-debate.roundLock', JSON.stringify({ active: true }));
    initLock(null, async () => {});
    expect(isAiLocked()).toBe(true); // ...but one valid "active" is enough to lock
  });

  it('release unlocks and clears both copies', async () => {
    const saved: LockState[] = [];
    initLock(undefined, async (s) => void saved.push(s));
    await engageLock('round-1', 1);
    await releaseLock();
    expect(isAiLocked()).toBe(false);
    expect(saved.map((s) => s.active)).toEqual([true, false]);
    lockState.value = null;
    initLock(saved[saved.length - 1], async () => {});
    expect(isAiLocked()).toBe(false);
  });
});

describe('rounds and the lock', () => {
  beforeEach(freshStore);

  it('starting a round turns AI off; ending it turns AI back on', async () => {
    expect(isAiLocked()).toBe(false);
    const round = await start();
    expect(isAiLocked()).toBe(true);
    expect(() => assertAiAllowed()).toThrow(/Round Mode is on/);
    expect(activeRound()?.id).toBe(round.id);
    const endedId = await endRound();
    expect(endedId).toBe(round.id);
    expect(isAiLocked()).toBe(false);
    expect(db.rounds.get(round.id)!.status).toBe('finished');
    expect(db.rounds.get(round.id)!.endedAt).not.toBeNull();
  });

  it('restarting the app mid-round does NOT turn AI back on', async () => {
    const round = await start();
    await restartApp();
    expect(isAiLocked()).toBe(true);
    expect(activeRound()?.id).toBe(round.id);
    await restartApp();
    expect(isAiLocked()).toBe(true);
  });

  it('clearing localStorage mid-round does not unlock (the database copy holds)', async () => {
    await start();
    localStorage.clear();
    await restartApp();
    expect(isAiLocked()).toBe(true);
  });

  it('after ending, a restart stays unlocked', async () => {
    await start();
    await endRound();
    await restartApp();
    expect(isAiLocked()).toBe(false);
  });

  it('a practice round locks AI just like a real one', async () => {
    await startRound({ name: '', meta, practice: true, formatId: 'nsda-hs', mergeBlock: true });
    expect(isAiLocked()).toBe(true);
  });

  it('if the round data is lost, the app stays locked but can still end the round', async () => {
    const round = await start();
    db.rounds.remove(round.id, 'gone');
    await restartApp();
    expect(isAiLocked()).toBe(true);
    expect(activeRound()).toBeUndefined();
    expect(await endRound()).toBeNull();
    expect(isAiLocked()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 2: the shape of the code
// ---------------------------------------------------------------------------

const SRC = join(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Everything a file imports, as written in its import/export-from statements. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (let m; (m = re.exec(text)); ) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

describe('code structure', () => {
  const files = sourceFiles(SRC);
  const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/');

  it('only src/ai/client.ts may talk to the AI service', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const name = rel(file);
      if (name === 'ai/client.ts') continue;
      const text = readFileSync(file, 'utf8');
      // No other file may import the SDK...
      if (importsOf(file).some((i) => i.startsWith('@anthropic-ai/'))) offenders.push(`${name} imports the Anthropic SDK`);
      // ...or build its own request to the API. (platform/ only relays for client.ts and never names the host in code.)
      const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, (s) => (/\/v1\/messages|https?:\/\/api\.anthropic/.test(s) ? s : "''"));
      if (/\/v1\/messages|https?:\/\/api\.anthropic/.test(code)) offenders.push(`${name} mentions the API endpoint in code`);
    }
    expect(offenders).toEqual([]);
  });

  it('Round Mode code imports nothing from src/ai except the lock', () => {
    const offenders: string[] = [];
    for (const file of files.filter((f) => rel(f).startsWith('features/round/'))) {
      for (const imp of importsOf(file)) {
        if (/(^|\/)ai\//.test(imp) && !/(^|\/)ai\/lock$/.test(imp)) offenders.push(`${rel(file)} imports ${imp}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nothing Round Mode loads, however indirectly, reaches the AI client or the AI tasks', () => {
    // Follow every import from the Round Mode screen, and the imports of those files, and so on.
    const resolve = (from: string, spec: string): string | null => {
      if (!spec.startsWith('.')) return null; // a package, not app code
      const base = join(from, '..', spec);
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (files.includes(candidate)) return candidate;
      }
      return null;
    };
    const reached = new Set<string>();
    const queue = files.filter((f) => rel(f).startsWith('features/round/'));
    while (queue.length) {
      const file = queue.pop()!;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const spec of importsOf(file)) {
        const target = resolve(file, spec);
        if (target && !reached.has(target)) queue.push(target);
      }
    }
    const names = [...reached].map(rel);
    expect(names).toContain('features/round/RoundDocs.tsx'); // sanity: the walk really ran
    expect(names).toContain('features/blocks/blockService.ts');
    expect(names.filter((n) => n.startsWith('ai/') && n !== 'ai/lock.ts')).toEqual([]);
    expect(names.filter((n) => n.startsWith('features/ai/'))).toEqual([]);
    // And no package that could reach an AI service is pulled in either.
    const packages = new Set([...reached].flatMap((f) => importsOf(f).filter((i) => !i.startsWith('.'))));
    expect([...packages].filter((p) => /anthropic|openai|\bai\b/i.test(p))).toEqual([]);
  });

  it('the lock file itself depends on nothing in the app', () => {
    expect(importsOf(join(SRC, 'ai/lock.ts'))).toEqual(['@preact/signals']);
  });

  it('nothing but the round service and the store can flip the lock', () => {
    const allowed = new Set(['ai/lock.ts', 'features/round/roundService.ts', 'data/store.ts']);
    const offenders = files
      .filter((f) => !allowed.has(rel(f)))
      .filter((f) => /\b(engageLock|releaseLock|initLock|resetLockForTests)\b/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
