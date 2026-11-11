// Timer alerts: beeps, vibration, and a screen flash.
//
// Sounds are generated on the spot (no audio files), so they work offline.
// Browsers only allow sound after the user has clicked or pressed a key, so
// primeAudio() is called from the timer's start button.

import type { AlertKind } from '../../core/timer/timer';

let ctx: AudioContext | null = null;

export function primeAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // No audio on this machine: the visual alert still works.
  }
}

function beep(at: number, freq: number, seconds: number): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Fade in and out quickly so the beep does not click.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

export function playAlert(kind: AlertKind): void {
  primeAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  if (kind === 'warning') {
    beep(t, 880, 0.12);
    beep(t + 0.2, 880, 0.12);
  } else {
    beep(t, 660, 0.3);
    beep(t + 0.4, 660, 0.3);
    beep(t + 0.8, 520, 0.5);
  }
}

/** Vibrate, where the device can (phones and some tablets; laptops ignore this). */
export function vibrateAlert(kind: AlertKind): void {
  try {
    navigator.vibrate?.(kind === 'warning' ? [120, 80, 120] : [300, 120, 300, 120, 500]);
  } catch {
    /* not supported */
  }
}

export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
