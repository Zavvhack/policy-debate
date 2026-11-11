// Timer accuracy. The timer must be exact no matter how irregularly the screen
// is refreshed, because a slow laptop or a background tab refreshes rarely.
import { describe, expect, it } from 'vitest';
import {
  adjust,
  alertsCrossed,
  createCountdown,
  createRoundClock,
  goToStep,
  pause,
  pauseAll,
  remaining,
  reset,
  runningTimer,
  setRemaining,
  start,
  togglePrep,
  toggleSpeech,
  type AlertKind,
} from '../../src/core/timer/timer';
import { BUILT_IN_FORMATS, ROUND_STEPS, roundSeconds, stepSeconds, validateFormat } from '../../src/core/debate/formats';
import { formatClock } from '../../src/core/ids';
import { parseClockInput } from '../../src/features/round/TimerBar';

const T0 = 1_800_000_000_000; // an arbitrary "now"
const MIN = 60_000;

describe('countdown', () => {
  it('is exact however irregular the ticks are', () => {
    let c = start(createCountdown(8 * MIN), T0);
    // Readings at uneven moments: each must equal duration minus real elapsed time.
    for (const elapsed of [1, 16, 17, 250, 999, 1000, 1001, 59_999, 123_456, 479_999, 480_000]) {
      expect(remaining(c, T0 + elapsed)).toBe(8 * MIN - elapsed);
    }
    // A 90-second gap with no readings at all (a suspended tab) loses nothing.
    c = pause(c, T0 + 90_000);
    expect(c.remainingMs).toBe(8 * MIN - 90_000);
  });

  it('does not drift over many pause/resume cycles', () => {
    let c = createCountdown(5 * MIN);
    let t = T0;
    let ran = 0;
    for (let i = 0; i < 500; i++) {
      c = start(c, t);
      const run = 137 + (i % 7) * 13; // odd lengths on purpose
      t += run;
      ran += run;
      c = pause(c, t);
      t += 41; // time passes while paused and must not count
    }
    expect(remaining(c, t)).toBe(5 * MIN - ran);
  });

  it('keeps counting past zero so you can see how far over you are', () => {
    const c = start(createCountdown(1000), T0);
    expect(remaining(c, T0 + 4000)).toBe(-3000);
    expect(formatClock(-3000)).toBe('-0:03');
  });

  it('paused timers do not move', () => {
    const c = createCountdown(3 * MIN);
    expect(remaining(c, T0 + 10 * MIN)).toBe(3 * MIN);
  });

  it('never shows more time if the system clock jumps backwards', () => {
    const c = start(createCountdown(60_000), T0);
    expect(remaining(c, T0 - 5000)).toBe(60_000);
  });

  it('start and pause are safe to repeat', () => {
    const c = start(createCountdown(1000), T0);
    expect(start(c, T0 + 500)).toBe(c);
    const p = pause(c, T0 + 200);
    expect(pause(p, T0 + 900)).toBe(p);
  });

  it('adjust and setRemaining work while running', () => {
    let c = start(createCountdown(60_000), T0);
    c = adjust(c, 10_000, T0 + 5000);
    expect(remaining(c, T0 + 5000)).toBe(65_000);
    expect(remaining(c, T0 + 6000)).toBe(64_000);
    c = setRemaining(c, 30_000, T0 + 6000);
    expect(remaining(c, T0 + 7000)).toBe(29_000);
    expect(reset(c).remainingMs).toBe(60_000);
    expect(reset(c).running).toBe(false);
  });

  it('survives being saved and loaded mid-run', () => {
    const c = start(createCountdown(8 * MIN), T0);
    const loaded = JSON.parse(JSON.stringify(c));
    expect(remaining(loaded, T0 + 61_000)).toBe(8 * MIN - 61_000);
  });
});

describe('alerts', () => {
  const collect = (readings: number[], warn: number): AlertKind[] => {
    const out: AlertKind[] = [];
    for (let i = 1; i < readings.length; i++) out.push(...alertsCrossed(readings[i - 1], readings[i], warn));
    return out;
  };

  it('fires the warning exactly once, then the end exactly once', () => {
    const readings: number[] = [];
    for (let ms = 35_000; ms >= -2000; ms -= 200) readings.push(ms);
    expect(collect(readings, 30_000)).toEqual(['warning', 'done']);
  });

  it('still fires when readings jump over the threshold', () => {
    expect(alertsCrossed(31_000, 29_000, 30_000)).toEqual(['warning']);
    expect(alertsCrossed(400, -900, 30_000)).toEqual(['done']);
  });

  it('announces only the end if a long gap skips both', () => {
    expect(alertsCrossed(45_000, -10_000, 30_000)).toEqual(['done']);
  });

  it('does nothing when paused, reset, or when time is added', () => {
    expect(alertsCrossed(20_000, 20_000, 30_000)).toEqual([]);
    expect(alertsCrossed(20_000, 480_000, 30_000)).toEqual([]);
  });

  it('a warning of 0 is off', () => {
    expect(collect([5000, 3000, 1000, 500], 0)).toEqual([]);
  });

  it('does not repeat the end alert while over time', () => {
    expect(alertsCrossed(-100, -300, 30_000)).toEqual([]);
  });
});

describe('round clock', () => {
  const format = BUILT_IN_FORMATS[0];

  it('starts on the 1AC with full prep for both teams', () => {
    const clock = createRoundClock(format);
    expect(ROUND_STEPS[clock.stepIndex].label).toBe('1AC');
    expect(clock.speech.durationMs).toBe(8 * MIN);
    expect(clock.prep.aff.durationMs).toBe(8 * MIN);
    expect(clock.prep.neg.durationMs).toBe(8 * MIN);
  });

  it('only one timer runs at a time', () => {
    let clock = createRoundClock(format);
    clock = toggleSpeech(clock, T0);
    expect(runningTimer(clock)).toBe('speech');
    clock = togglePrep(clock, 'neg', T0 + 1000);
    expect(runningTimer(clock)).toBe('prep-neg');
    expect(clock.speech.running).toBe(false);
    expect(clock.speech.remainingMs).toBe(8 * MIN - 1000);
    clock = togglePrep(clock, 'aff', T0 + 3000);
    expect(runningTimer(clock)).toBe('prep-aff');
    expect(clock.prep.neg.remainingMs).toBe(8 * MIN - 2000);
    clock = toggleSpeech(clock, T0 + 4000);
    expect(runningTimer(clock)).toBe('speech');
    expect(clock.prep.aff.remainingMs).toBe(8 * MIN - 1000);
    clock = pauseAll(clock, T0 + 5000);
    expect(runningTimer(clock)).toBeNull();
  });

  it('moving to another speech loads its length and keeps prep', () => {
    let clock = createRoundClock(format);
    clock = togglePrep(clock, 'aff', T0);
    clock = togglePrep(clock, 'aff', T0 + 30_000);
    clock = goToStep(clock, 1, format);
    expect(ROUND_STEPS[clock.stepIndex].label).toBe('CX of 1AC');
    expect(clock.speech.durationMs).toBe(3 * MIN);
    expect(clock.prep.aff.remainingMs).toBe(8 * MIN - 30_000);
    expect(goToStep(clock, 99, format).stepIndex).toBe(ROUND_STEPS.length - 1);
    expect(goToStep(clock, -5, format).stepIndex).toBe(0);
  });
});

describe('time formats', () => {
  it('has the twelve steps in the right order', () => {
    expect(ROUND_STEPS.map((s) => s.label)).toEqual([
      '1AC', 'CX of 1AC', '1NC', 'CX of 1NC', '2AC', 'CX of 2AC', '2NC', 'CX of 2NC', '1NR', '1AR', '2NR', '2AR',
    ]);
    expect(ROUND_STEPS.filter((s) => s.kind === 'cx').map((s) => s.detail)).toEqual([
      '2N questions 1A', '1A questions 1N', '1N questions 2A', '2A questions 2N',
    ]);
    // The side that just listened asks the questions.
    for (const s of ROUND_STEPS.filter((x) => x.kind === 'cx')) {
      const speech = ROUND_STEPS.find((x) => x.kind === 'speech' && x.speech === s.speech)!;
      expect(s.side).not.toBe(speech.side);
    }
  });

  it('matches the published times', () => {
    const by = (id: string) => BUILT_IN_FORMATS.find((f) => f.id === id)!;
    const times = (id: string) => {
      const f = by(id);
      return [f.constructive / 60, f.cx / 60, f.rebuttal / 60, f.prep / 60];
    };
    expect(times('nsda-hs')).toEqual([8, 3, 5, 8]);
    expect(times('bdl-hs')).toEqual([8, 3, 5, 8]);
    expect(times('bdl-ms-novice')).toEqual([3, 2, 3, 5]);
    expect(times('bdl-ms-jv')).toEqual([5, 2, 3, 5]);
    expect(times('bdl-ms-varsity')).toEqual([6, 2, 3, 5]);
    expect(times('college-ndt')).toEqual([9, 3, 6, 10]);
    // 4 constructives + 4 CX + 4 rebuttals
    expect(roundSeconds(by('nsda-hs'))).toBe((4 * 8 + 4 * 3 + 4 * 5) * 60);
    expect(stepSeconds(ROUND_STEPS[8], by('nsda-hs'))).toBe(5 * 60); // the 1NR is a rebuttal
    for (const f of BUILT_IN_FORMATS) {
      expect(f.source, f.id).toBeTruthy();
      expect(validateFormat(f)).toEqual([]);
    }
  });

  it('rejects nonsense custom formats', () => {
    const bad = { ...BUILT_IN_FORMATS[0], name: ' ', constructive: 0, prep: -1 };
    expect(validateFormat(bad).length).toBe(3);
  });
});

describe('clock text', () => {
  it('formats', () => {
    expect(formatClock(8 * MIN)).toBe('8:00');
    expect(formatClock(59_001)).toBe('1:00'); // rounds up: never shows 0:59 while a full minute is left
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-400)).toBe('0:00');
    expect(formatClock(-61_000)).toBe('-1:01');
  });
  it('parses what people type', () => {
    expect(parseClockInput('7:30')).toBe(450_000);
    expect(parseClockInput('5')).toBe(300_000);
    expect(parseClockInput('0:07')).toBe(7000);
    expect(parseClockInput('90x')).toBeNull();
    expect(parseClockInput('7:75')).toBeNull();
    expect(parseClockInput('')).toBeNull();
  });
});
