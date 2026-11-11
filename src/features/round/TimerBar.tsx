// The timers: one for the current speech or cross-examination, and prep for each team.

import { useEffect, useRef, useState } from 'preact/hooks';
import { formatClock, now } from '../../core/ids';
import { ROUND_STEPS, stepSeconds, type Side, type TimeFormat } from '../../core/debate/formats';
import {
  alertsCrossed,
  goToStep,
  remaining,
  reset,
  runningTimer,
  setRemaining,
  togglePrep,
  toggleSpeech,
  type AlertKind,
  type Countdown,
  type RoundClock,
} from '../../core/timer/timer';
import { settings } from '../../data/store';
import { openDialog, TextInput } from '../../ui/kit';
import { playAlert, primeAudio, vibrateAlert } from './sound';

interface Props {
  clock: RoundClock;
  format: TimeFormat;
  onChange: (clock: RoundClock) => void;
  /** True in the full-screen "big timer" view. */
  big: boolean;
  onToggleBig: () => void;
}

/** "7:30" or "450" (seconds) or "7" (minutes) -> milliseconds. Null if it makes no sense. */
export function parseClockInput(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  if (/^\d{1,2}$/.test(t)) return Number(t) * 60 * 1000;
  if (/^\d{3,4}$/.test(t)) return Number(t) * 1000;
  return null;
}

async function askForTime(title: string, currentMs: number): Promise<number | null> {
  const result = await openDialog<number>((close) => {
    const Body = () => {
      const [text, setText] = useState(formatClock(Math.max(0, currentMs)));
      const ms = parseClockInput(text);
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ms !== null) close(ms);
          }}
        >
          <h2 class="dialog-title">{title}</h2>
          <div class="dialog-body">
            <TextInput value={text} onChange={setText} aria-label="Time left" autofocus />
            <p class="field-hint">Type minutes:seconds (7:30), or just minutes (7).</p>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn" onClick={() => close()}>
              Cancel
            </button>
            <button type="submit" class="btn btn-primary" disabled={ms === null}>
              Set time
            </button>
          </div>
        </form>
      );
    };
    return <Body />;
  });
  return result ?? null;
}

export function TimerBar({ clock, format, onChange, big, onToggleBig }: Props) {
  // `tick` exists only to re-draw the clocks; the real time always comes from the Countdown data.
  const [, setTick] = useState(0);
  const [flash, setFlash] = useState<AlertKind | null>(null);
  const previous = useRef<{ speech: number; aff: number; neg: number } | null>(null);
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const running = runningTimer(clock);
  const t = now();
  const prefs = settings.value.timer;

  const fire = (kind: AlertKind) => {
    const p = settings.value.timer;
    if (p.sound) playAlert(kind);
    if (p.vibrate) vibrateAlert(kind);
    if (p.flash) {
      setFlash(kind);
      setTimeout(() => setFlash(null), kind === 'done' ? 2400 : 1200);
    }
  };

  // While a timer runs, look at the clock five times a second: re-draw, and
  // fire an alert when a threshold has been crossed since the last look.
  useEffect(() => {
    if (!running) {
      previous.current = null;
      return;
    }
    const poll = () => {
      const c = clockRef.current;
      const at = now();
      const cur = { speech: remaining(c.speech, at), aff: remaining(c.prep.aff, at), neg: remaining(c.prep.neg, at) };
      const prev = previous.current;
      if (prev) {
        const warn = settings.value.timer.warningSec * 1000;
        const kinds: AlertKind[] = [
          ...alertsCrossed(prev.speech, cur.speech, warn),
          ...alertsCrossed(prev.aff, cur.aff, warn),
          ...alertsCrossed(prev.neg, cur.neg, warn),
        ];
        if (kinds.includes('done')) fire('done');
        else if (kinds.includes('warning')) fire('warning');
      }
      previous.current = cur;
      setTick((n) => n + 1);
    };
    poll();
    const id = setInterval(poll, 200);
    // A tab that was in the background gets an immediate catch-up when it comes back.
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [running]);

  const step = ROUND_STEPS[clock.stepIndex];
  const speechLeft = remaining(clock.speech, t);
  const warnMs = prefs.warningSec * 1000;
  const state = (ms: number, c: Countdown) => (ms <= 0 ? 'is-over' : warnMs > 0 && ms <= warnMs ? 'is-warning' : c.running ? 'is-running' : '');

  const doToggleSpeech = () => {
    primeAudio();
    onChange(toggleSpeech(clock, now()));
  };
  const doTogglePrep = (side: Side) => {
    primeAudio();
    onChange(togglePrep(clock, side, now()));
  };
  const go = (index: number) => onChange(goToStep(clock, index, format));
  const editSpeech = async () => {
    const ms = await askForTime(`Set the ${step.label} timer`, speechLeft);
    if (ms !== null) onChange({ ...clockRef.current, speech: setRemaining(clockRef.current.speech, ms, now()) });
  };
  const editPrep = async (side: Side) => {
    const ms = await askForTime(`Set ${side === 'aff' ? 'Aff' : 'Neg'} prep`, remaining(clock.prep[side], now()));
    if (ms !== null) {
      const c = clockRef.current;
      onChange({ ...c, prep: { ...c.prep, [side]: setRemaining(c.prep[side], ms, now()) } });
    }
  };

  // Keyboard shortcuts. Alt+letter works while typing on the flow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const c = clockRef.current;
      let handled = true;
      switch (e.code) {
        case 'KeyS':
          primeAudio();
          onChange(toggleSpeech(c, now()));
          break;
        case 'KeyA':
          primeAudio();
          onChange(togglePrep(c, 'aff', now()));
          break;
        case 'KeyN':
          primeAudio();
          onChange(togglePrep(c, 'neg', now()));
          break;
        case 'Period':
          onChange(goToStep(c, c.stepIndex + 1, format));
          break;
        case 'Comma':
          onChange(goToStep(c, c.stepIndex - 1, format));
          break;
        case 'KeyR':
          onChange({ ...c, speech: reset(c.speech, stepSeconds(ROUND_STEPS[c.stepIndex], format) * 1000) });
          break;
        case 'KeyB':
          onToggleBig();
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [format, onChange, onToggleBig]);

  const prepBox = (side: Side) => {
    const c = clock.prep[side];
    const left = remaining(c, t);
    return (
      <div class={`prep prep-${side} ${state(left, c)}`}>
        <button
          class="prep-main"
          onClick={() => doTogglePrep(side)}
          title={`${c.running ? 'Stop' : 'Start'} ${side === 'aff' ? 'Aff' : 'Neg'} prep (Alt+${side === 'aff' ? 'A' : 'N'})`}
          aria-label={`${side === 'aff' ? 'Affirmative' : 'Negative'} prep, ${formatClock(left)} left. ${c.running ? 'Running. Press to stop.' : 'Press to start.'}`}
        >
          <span class="prep-label">{side === 'aff' ? 'Aff prep' : 'Neg prep'}</span>
          <span class="prep-time">{formatClock(left)}</span>
          <span class="prep-state">{c.running ? 'Stop' : 'Start'}</span>
        </button>
        <button class="icon-btn" onClick={() => editPrep(side)} title="Change the time left" aria-label={`Change ${side} prep time`}>
          ✎
        </button>
      </div>
    );
  };

  return (
    <section class={`timerbar ${big ? 'is-big' : ''} ${flash ? `flash-${flash}` : ''}`} aria-label="Timers">
      <div class={`speech-timer side-${step.side} ${state(speechLeft, clock.speech)}`}>
        <div class="speech-meta">
          <div class="speech-label">{step.label}</div>
          <div class="speech-detail">{step.detail}</div>
        </div>
        <div class="speech-time" role="timer" aria-label={`${step.label}: ${formatClock(speechLeft)} left`}>
          {formatClock(speechLeft)}
        </div>
        <div class="speech-controls">
          <button class="btn btn-primary btn-timer" onClick={doToggleSpeech} title="Start or stop (Alt+S)">
            {clock.speech.running ? 'Stop' : 'Start'}
          </button>
          <button class="btn" onClick={() => go(clock.stepIndex - 1)} disabled={clock.stepIndex === 0} title="Previous speech (Alt+,)" aria-label="Previous speech">
            ‹
          </button>
          <button
            class="btn"
            onClick={() => go(clock.stepIndex + 1)}
            disabled={clock.stepIndex === ROUND_STEPS.length - 1}
            title="Next speech (Alt+.)"
            aria-label="Next speech"
          >
            ›
          </button>
          <button
            class="btn"
            onClick={() => onChange({ ...clock, speech: reset(clock.speech, stepSeconds(step, format) * 1000) })}
            title="Reset this timer (Alt+R)"
          >
            Reset
          </button>
          <button class="icon-btn" onClick={editSpeech} title="Change the time left" aria-label="Change the time left">
            ✎
          </button>
          <button class="btn" onClick={onToggleBig} title="Big timer on or off (Alt+B)" aria-pressed={big}>
            {big ? 'Small' : 'Big'}
          </button>
        </div>
      </div>
      <div class="preps">
        {prepBox('aff')}
        {prepBox('neg')}
      </div>
      {big && (
        <ol class="step-strip" aria-label="Speech order">
          {ROUND_STEPS.map((s, i) => (
            <li key={i}>
              <button class={`step-chip side-${s.side} ${i === clock.stepIndex ? 'is-current' : ''} ${i < clock.stepIndex ? 'is-past' : ''}`} onClick={() => go(i)}>
                {s.kind === 'cx' ? 'CX' : s.label}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
