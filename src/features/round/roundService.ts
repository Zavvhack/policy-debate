// Starting and ending rounds.
//
// These two functions are the ONLY places the Round Mode lock is switched on
// and off.

import { engageLock, lockState, releaseLock } from '../../ai/lock';
import { newId, now } from '../../core/ids';
import { BUILT_IN_FORMATS, type TimeFormat } from '../../core/debate/formats';
import { createSheet } from '../../core/flow/model';
import { createRoundClock, pauseAll } from '../../core/timer/timer';
import { activeTopic, db, flushWrites, settings, takeBackup } from '../../data/store';
import type { Round, RoundMeta } from '../../data/schema';

/** Every time format the user can pick: the built-in ones plus their own. */
export function allFormats(): TimeFormat[] {
  return [...BUILT_IN_FORMATS, ...settings.value.timer.customFormats];
}

export function formatById(id: string): TimeFormat {
  return allFormats().find((f) => f.id === id) ?? BUILT_IN_FORMATS[0];
}

export interface StartRoundInput {
  name: string;
  meta: RoundMeta;
  practice: boolean;
  formatId: string;
  mergeBlock: boolean;
}

/** Create a round and switch Round Mode on. AI is off from the first line of this function's lock call. */
export async function startRound(input: StartRoundInput): Promise<Round> {
  const format = { ...formatById(input.formatId) };
  const t = now();
  const round: Round = {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    topicId: activeTopic()?.id ?? '',
    name: input.name.trim() || defaultRoundName(input.meta, input.practice),
    meta: input.meta,
    practice: input.practice,
    status: 'active',
    startedAt: t,
    endedAt: null,
    format,
    mergeBlock: input.mergeBlock,
    sheets: [createSheet('Case', 'case', input.mergeBlock)],
    clock: createRoundClock(format),
    cxNotes: {},
    fills: {},
    result: '',
    whatWorked: '',
    reviewNotes: '',
  };
  // Lock first: engageLock() flips the lock before it does anything else, so AI
  // is off from this line on, even if saving fails. The round is put in memory
  // in the same breath, so Round Mode never draws without its round.
  const locked = engageLock(round.id, t);
  db.rounds.put(round);
  await locked;
  await flushWrites();
  return round;
}

export function defaultRoundName(meta: RoundMeta, practice: boolean): string {
  const bits = [
    practice ? 'Practice' : meta.tournament.trim(),
    meta.roundNumber.trim() ? `R${meta.roundNumber.trim().replace(/^r(ound)?\s*/i, '')}` : '',
    meta.side === 'aff' ? 'Aff' : 'Neg',
    meta.opponent.trim() ? `vs ${meta.opponent.trim()}` : '',
  ].filter(Boolean);
  return bits.join(' ') || 'Round';
}

/**
 * End the active round: stop the clocks, mark it finished, turn AI back on,
 * and take a backup. Works even if the round's data has gone missing, so the
 * app can never get stuck in Round Mode.
 */
export async function endRound(): Promise<string | null> {
  const roundId = lockState.value?.roundId ?? null;
  const round = db.rounds.get(roundId);
  const t = now();
  if (round) {
    db.rounds.put({ ...round, status: 'finished', endedAt: t, clock: pauseAll(round.clock, t) });
  }
  await flushWrites();
  await releaseLock();
  await takeBackup('After a round', true);
  return round?.id ?? null;
}

/** The round Round Mode is showing, if its data exists. */
export function activeRound(): Round | undefined {
  return db.rounds.get(lockState.value?.roundId);
}
