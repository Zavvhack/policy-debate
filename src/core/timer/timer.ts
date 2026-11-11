// Timer engine.
//
// The important idea: a running timer does NOT count ticks. It remembers the
// moment it was started and works out the time left from the clock each time
// you ask. That means:
//   - it cannot drift, however slow or busy the laptop is;
//   - a throttled background tab, a sleeping laptop, or a page reload does not
//     lose or gain time;
//   - the whole thing is plain data, so it can be saved and tested.
//
// Every function takes `now` (milliseconds) as an argument instead of reading
// the clock itself. The UI passes Date.now(); tests pass whatever they like.

export interface Countdown {
  /** Full length in ms. */
  durationMs: number;
  /** Time left at the moment the timer was last started or paused. */
  remainingMs: number;
  /** True while counting down. */
  running: boolean;
  /** Clock time (ms since 1970) when it was last started. Null while paused. */
  startedAt: number | null;
}

export function createCountdown(durationMs: number): Countdown {
  const d = Math.max(0, Math.round(durationMs));
  return { durationMs: d, remainingMs: d, running: false, startedAt: null };
}

/**
 * Time left right now, in ms. Can go negative: debaters need to see how far
 * over time a speech has run, so the timer keeps counting past zero.
 */
export function remaining(c: Countdown, now: number): number {
  if (!c.running || c.startedAt === null) return c.remainingMs;
  // If the system clock was moved backwards, never show MORE time than was left.
  const elapsed = Math.max(0, now - c.startedAt);
  return c.remainingMs - elapsed;
}

export function start(c: Countdown, now: number): Countdown {
  if (c.running) return c;
  return { ...c, running: true, startedAt: now };
}

export function pause(c: Countdown, now: number): Countdown {
  if (!c.running) return c;
  return { ...c, running: false, startedAt: null, remainingMs: remaining(c, now) };
}

export function toggle(c: Countdown, now: number): Countdown {
  return c.running ? pause(c, now) : start(c, now);
}

/** Back to the full duration, paused. */
export function reset(c: Countdown, durationMs = c.durationMs): Countdown {
  return createCountdown(durationMs);
}

/** Add (or with a negative number, remove) time without stopping the timer. */
export function adjust(c: Countdown, deltaMs: number, now: number): Countdown {
  const left = remaining(c, now) + deltaMs;
  return { ...c, remainingMs: left, startedAt: c.running ? now : null };
}

/** Set the time left to an exact value (used when you type a time in). */
export function setRemaining(c: Countdown, ms: number, now: number): Countdown {
  return { ...c, remainingMs: ms, startedAt: c.running ? now : null };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertKind = 'warning' | 'done';

/**
 * Which alerts should fire between two readings of the timer?
 *
 * The UI reads the timer several times a second. An alert fires when the time
 * left CROSSES a threshold between one reading and the next, so each alert
 * fires exactly once, even if readings are far apart (a throttled tab) and jump
 * straight over the threshold.
 *
 * @param before  time left at the previous reading (ms)
 * @param after   time left now (ms)
 * @param warningMs  the "30 seconds left" style warning; 0 or less turns it off
 */
export function alertsCrossed(before: number, after: number, warningMs: number): AlertKind[] {
  const out: AlertKind[] = [];
  if (after >= before) return out; // paused, reset, or time was added
  if (warningMs > 0 && before > warningMs && after <= warningMs && after > 0) out.push('warning');
  if (before > 0 && after <= 0) {
    // Jumped straight past the warning AND zero: only announce the end.
    out.push('done');
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole round's clock: one speech timer plus prep for each team.
// ---------------------------------------------------------------------------

import { ROUND_STEPS, stepSeconds, type Side, type TimeFormat } from '../debate/formats';

export interface RoundClock {
  /** Index into ROUND_STEPS (0 = 1AC ... 11 = 2AR). */
  stepIndex: number;
  /** Timer for the current speech or cross-examination. */
  speech: Countdown;
  /** Prep time left for each team. */
  prep: Record<Side, Countdown>;
}

export function createRoundClock(format: TimeFormat): RoundClock {
  return {
    stepIndex: 0,
    speech: createCountdown(stepSeconds(ROUND_STEPS[0], format) * 1000),
    prep: {
      aff: createCountdown(format.prep * 1000),
      neg: createCountdown(format.prep * 1000),
    },
  };
}

/** Jump to a step (speech or CX). The speech timer resets to that step's length, paused. */
export function goToStep(clock: RoundClock, index: number, format: TimeFormat): RoundClock {
  const i = Math.min(ROUND_STEPS.length - 1, Math.max(0, index));
  return { ...clock, stepIndex: i, speech: createCountdown(stepSeconds(ROUND_STEPS[i], format) * 1000) };
}

/**
 * Start or stop the speech timer. Starting a speech stops both prep timers:
 * prep and a speech can never run at the same time.
 */
export function toggleSpeech(clock: RoundClock, now: number): RoundClock {
  if (clock.speech.running) return { ...clock, speech: pause(clock.speech, now) };
  return {
    ...clock,
    speech: start(clock.speech, now),
    prep: { aff: pause(clock.prep.aff, now), neg: pause(clock.prep.neg, now) },
  };
}

/**
 * Start or stop one team's prep. Starting prep stops the speech timer and the
 * other team's prep, so only one clock ever runs.
 */
export function togglePrep(clock: RoundClock, side: Side, now: number): RoundClock {
  const other: Side = side === 'aff' ? 'neg' : 'aff';
  if (clock.prep[side].running) {
    return { ...clock, prep: { ...clock.prep, [side]: pause(clock.prep[side], now) } as Record<Side, Countdown> };
  }
  return {
    ...clock,
    speech: pause(clock.speech, now),
    prep: {
      [side]: start(clock.prep[side], now),
      [other]: pause(clock.prep[other], now),
    } as Record<Side, Countdown>,
  };
}

/** Stop everything (used when the round ends or the app is closing). */
export function pauseAll(clock: RoundClock, now: number): RoundClock {
  return {
    ...clock,
    speech: pause(clock.speech, now),
    prep: { aff: pause(clock.prep.aff, now), neg: pause(clock.prep.neg, now) },
  };
}

/** Which timer, if any, is running? */
export function runningTimer(clock: RoundClock): 'speech' | 'prep-aff' | 'prep-neg' | null {
  if (clock.speech.running) return 'speech';
  if (clock.prep.aff.running) return 'prep-aff';
  if (clock.prep.neg.running) return 'prep-neg';
  return null;
}
