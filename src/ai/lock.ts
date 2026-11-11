// THE ROUND MODE LOCK
// ===================
// Rule: no AI during a round, ever.
//
// This file is the single source of truth for "is a round in progress?".
// Every AI request in the app goes through src/ai/client.ts, and the first
// thing that file does is call assertAiAllowed() from here. There is no other
// way to reach Claude, so if this says "locked", AI is off - not just hidden.
//
// Design choices that make the lock hard to get wrong:
//
//  * FAIL CLOSED. Until the saved state has been loaded, the lock counts as
//    ON. A crash, a slow disk, or a bug during start-up can only ever leave
//    AI switched off, never on.
//
//  * TWO SAVED COPIES. The state is kept in the app database and mirrored in
//    localStorage. If EITHER copy says a round is active, it is active. So
//    reloading the page or restarting the app in the middle of a round keeps
//    AI off.
//
//  * ONE WAY OUT. Only releaseLock() turns AI back on, and the only thing
//    that calls it is "End round".
//
// This file deliberately imports nothing from the rest of the app (apart from
// the signals library), so it can be read and tested on its own.

import { signal } from '@preact/signals';

export interface LockState {
  active: boolean;
  /** The round that switched the lock on. */
  roundId: string | null;
  /** When it was switched on (ms since 1970). */
  since: number | null;
}

const UNLOCKED: LockState = { active: false, roundId: null, since: null };
const MIRROR_KEY = 'policy-debate.roundLock';

/** Current state. `null` means "not loaded yet", which is treated as LOCKED. */
export const lockState = signal<LockState | null>(null);

/** True whenever AI must not be used. */
export function isAiLocked(): boolean {
  const s = lockState.value;
  if (s === null || s.active) return true;
  // ANOTHER WINDOW. If the app is open twice (two browser tabs), a round
  // started in the other one is written to the shared mirror straight away.
  // Checking it here means AI is refused in this window too, even before this
  // window has re-drawn itself.
  return readMirror()?.active === true;
}

/** Thrown by every AI function while a round is active. */
export class AiLockedError extends Error {
  constructor() {
    super('Round Mode is on, so AI is switched off. End the round to use AI again.');
    this.name = 'AiLockedError';
  }
}

/** Call this before anything that would contact an AI service. */
export function assertAiAllowed(): void {
  if (isAiLocked()) throw new AiLockedError();
}

type Saver = (state: LockState) => Promise<void>;
let saver: Saver = async () => {};

function readMirror(): LockState | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LockState>;
    return { active: v.active === true, roundId: typeof v.roundId === 'string' ? v.roundId : null, since: typeof v.since === 'number' ? v.since : null };
  } catch {
    return null;
  }
}

function writeMirror(state: LockState): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
  } catch {
    // localStorage can be blocked; the database copy still protects us.
  }
}

/**
 * Load the lock at start-up.
 * @param saved the copy from the app database (undefined if there is none)
 * @param save  how to write the state back to the database (and tell the desktop shell)
 */
export function initLock(saved: Partial<LockState> | null | undefined, save: Saver): LockState {
  saver = save;
  const mirror = readMirror();
  const active = saved?.active === true || mirror?.active === true;
  const state: LockState = active
    ? {
        active: true,
        roundId: (typeof saved?.roundId === 'string' ? saved.roundId : null) ?? mirror?.roundId ?? null,
        since: (typeof saved?.since === 'number' ? saved.since : null) ?? mirror?.since ?? null,
      }
    : UNLOCKED;
  lockState.value = state;
  writeMirror(state);
  return state;
}

/**
 * Follow a round that was started or ended in ANOTHER window of the app.
 * Browsers send a "storage" event to every other tab when the mirror changes.
 *
 *  - Started elsewhere: lock this window at once.
 *  - Ended elsewhere: unlock only if the database copy agrees (two copies must
 *    both say "no round" before AI comes back).
 */
export function watchOtherWindows(readSaved: () => Promise<Partial<LockState> | null | undefined>): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== MIRROR_KEY) return;
    if (lockState.value === null) return; // not loaded yet: still locked
    const mirror = readMirror();
    if (mirror?.active) {
      if (!lockState.value.active) lockState.value = { active: true, roundId: mirror.roundId, since: mirror.since };
      return;
    }
    if (!lockState.value.active) return;
    // The other window clears the mirror a moment before its database copy, so look a few times.
    const check = (triesLeft: number) => {
      void Promise.resolve()
        .then(readSaved)
        .then((saved) => {
          if (readMirror()?.active === true) return;
          if (saved?.active !== true) lockState.value = UNLOCKED;
          else if (triesLeft > 0) setTimeout(() => check(triesLeft - 1), 700);
        })
        .catch(() => {
          /* could not check: stay locked */
        });
    };
    check(4);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** Switch AI off for a round. The in-memory lock flips first, so AI is off before anything else happens. */
export async function engageLock(roundId: string, now: number): Promise<void> {
  const state: LockState = { active: true, roundId, since: now };
  lockState.value = state;
  writeMirror(state);
  await saver(state);
}

/** Switch AI back on. Only "End round" calls this. */
export async function releaseLock(): Promise<void> {
  writeMirror(UNLOCKED);
  try {
    await saver(UNLOCKED);
  } finally {
    lockState.value = UNLOCKED;
  }
}

/** Tests only: put the lock back to "not loaded". */
export function resetLockForTests(): void {
  lockState.value = null;
  saver = async () => {};
  try {
    localStorage.removeItem(MIRROR_KEY);
  } catch {
    /* ignore */
  }
}
