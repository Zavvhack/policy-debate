// Speech order and time formats.
//
// Every preset below was checked against the organisation's own published rules.
// The `source` field says exactly where, so you can re-check it next season.
// If your league is different, make a custom format in Settings.

export type Side = 'aff' | 'neg';

/** The eight speeches, in order. */
export type SpeechId = '1AC' | '1NC' | '2AC' | '2NC' | '1NR' | '1AR' | '2NR' | '2AR';

export const SPEECHES: readonly SpeechId[] = ['1AC', '1NC', '2AC', '2NC', '1NR', '1AR', '2NR', '2AR'];

export const SPEECH_SIDE: Record<SpeechId, Side> = {
  '1AC': 'aff',
  '1NC': 'neg',
  '2AC': 'aff',
  '2NC': 'neg',
  '1NR': 'neg',
  '1AR': 'aff',
  '2NR': 'neg',
  '2AR': 'aff',
};

export const SPEECH_NAME: Record<SpeechId, string> = {
  '1AC': 'First Affirmative Constructive',
  '1NC': 'First Negative Constructive',
  '2AC': 'Second Affirmative Constructive',
  '2NC': 'Second Negative Constructive',
  '1NR': 'First Negative Rebuttal',
  '1AR': 'First Affirmative Rebuttal',
  '2NR': 'Second Negative Rebuttal',
  '2AR': 'Second Affirmative Rebuttal',
};

export const CONSTRUCTIVES: readonly SpeechId[] = ['1AC', '1NC', '2AC', '2NC'];

/** One step of a round: a speech or a cross-examination. */
export interface RoundStep {
  kind: 'speech' | 'cx';
  /** For a speech: its id. For a CX: the speech being questioned. */
  speech: SpeechId;
  /** Short label for the timer, e.g. "1AC" or "CX of 1AC". */
  label: string;
  /** Who is speaking (speech) or asking the questions (CX). */
  side: Side;
  /** Human description, e.g. "2N questions 1A". */
  detail: string;
}

/**
 * The 12 steps of a policy round.
 *
 * Cross-examination: the national rules only fix which SIDE asks. The speaker
 * assignments below (2N asks the 1A, 1A asks the 1N, 1N asks the 2A, 2A asks the 2N)
 * are the standard convention - the person who is NOT about to speak asks, so
 * their partner can prep. Some leagues (e.g. the BDL guide) print it this way too.
 */
export const ROUND_STEPS: readonly RoundStep[] = [
  { kind: 'speech', speech: '1AC', label: '1AC', side: 'aff', detail: SPEECH_NAME['1AC'] },
  { kind: 'cx', speech: '1AC', label: 'CX of 1AC', side: 'neg', detail: '2N questions 1A' },
  { kind: 'speech', speech: '1NC', label: '1NC', side: 'neg', detail: SPEECH_NAME['1NC'] },
  { kind: 'cx', speech: '1NC', label: 'CX of 1NC', side: 'aff', detail: '1A questions 1N' },
  { kind: 'speech', speech: '2AC', label: '2AC', side: 'aff', detail: SPEECH_NAME['2AC'] },
  { kind: 'cx', speech: '2AC', label: 'CX of 2AC', side: 'neg', detail: '1N questions 2A' },
  { kind: 'speech', speech: '2NC', label: '2NC', side: 'neg', detail: SPEECH_NAME['2NC'] + ' (start of the negative block)' },
  { kind: 'cx', speech: '2NC', label: 'CX of 2NC', side: 'aff', detail: '2A questions 2N' },
  { kind: 'speech', speech: '1NR', label: '1NR', side: 'neg', detail: SPEECH_NAME['1NR'] + ' (end of the negative block)' },
  { kind: 'speech', speech: '1AR', label: '1AR', side: 'aff', detail: SPEECH_NAME['1AR'] },
  { kind: 'speech', speech: '2NR', label: '2NR', side: 'neg', detail: SPEECH_NAME['2NR'] },
  { kind: 'speech', speech: '2AR', label: '2AR', side: 'aff', detail: SPEECH_NAME['2AR'] },
];

/** A set of time limits. All values are in seconds. */
export interface TimeFormat {
  id: string;
  name: string;
  constructive: number;
  cx: number;
  rebuttal: number;
  /** Prep time for EACH team. */
  prep: number;
  /** Where the numbers come from. Empty for formats you made yourself. */
  source?: string;
  sourceUrl?: string;
  /** True for the presets that ship with the app (they cannot be edited, only copied). */
  builtIn?: boolean;
}

const MIN = 60;

export const BUILT_IN_FORMATS: readonly TimeFormat[] = [
  {
    id: 'nsda-hs',
    name: 'High school (NSDA): 8-3-5, 8 min prep',
    constructive: 8 * MIN,
    cx: 3 * MIN,
    rebuttal: 5 * MIN,
    prep: 8 * MIN,
    source: 'NSDA High School Unified Manual 2026-2027 (v2027.1.2), Policy Debate Time Limits: "Prep Time 8 Minutes per Team".',
    sourceUrl: 'https://www.speechanddebate.org/high-school-unified-manual/',
    builtIn: true,
  },
  {
    id: 'bdl-hs',
    name: 'Boston Debate League, high school: 8-3-5, 8 min prep',
    constructive: 8 * MIN,
    cx: 3 * MIN,
    rebuttal: 5 * MIN,
    prep: 8 * MIN,
    source: 'Boston Debate League Speech Order Guide (2025): High School, all divisions.',
    sourceUrl: 'https://www.bostondebate.org/volunteer-resources/',
    builtIn: true,
  },
  {
    id: 'bdl-ms-novice',
    name: 'Boston Debate League, middle school Novice: 3-2-3, 5 min prep',
    constructive: 3 * MIN,
    cx: 2 * MIN,
    rebuttal: 3 * MIN,
    prep: 5 * MIN,
    source: 'Boston Debate League Speech Order Guide (2025): Middle School, Novice.',
    sourceUrl: 'https://www.bostondebate.org/volunteer-resources/',
    builtIn: true,
  },
  {
    id: 'bdl-ms-jv',
    name: 'Boston Debate League, middle school JV: 5-2-3, 5 min prep',
    constructive: 5 * MIN,
    cx: 2 * MIN,
    rebuttal: 3 * MIN,
    prep: 5 * MIN,
    source: 'Boston Debate League Speech Order Guide (2025): Middle School, JV.',
    sourceUrl: 'https://www.bostondebate.org/volunteer-resources/',
    builtIn: true,
  },
  {
    id: 'bdl-ms-varsity',
    name: 'Boston Debate League, middle school Varsity: 6-2-3, 5 min prep',
    constructive: 6 * MIN,
    cx: 2 * MIN,
    rebuttal: 3 * MIN,
    prep: 5 * MIN,
    source: 'Boston Debate League Speech Order Guide (2025): Middle School, Varsity.',
    sourceUrl: 'https://www.bostondebate.org/volunteer-resources/',
    builtIn: true,
  },
  {
    id: 'college-ndt',
    name: 'College (NDT): 9-3-6, 10 min prep',
    constructive: 9 * MIN,
    cx: 3 * MIN,
    rebuttal: 6 * MIN,
    prep: 10 * MIN,
    source: 'Standing Rules for the Operation of the National Debate Tournament (revised December 2025).',
    sourceUrl: 'https://nationaldebatetournament.org/about/standing-rules/',
    builtIn: true,
  },
];

export const DEFAULT_FORMAT_ID = 'nsda-hs';

/** How long one step lasts under a format, in seconds. */
export function stepSeconds(step: RoundStep, f: TimeFormat): number {
  if (step.kind === 'cx') return f.cx;
  return CONSTRUCTIVES.includes(step.speech) ? f.constructive : f.rebuttal;
}

/** Total speaking time of a round (no prep), in seconds. */
export function roundSeconds(f: TimeFormat): number {
  return ROUND_STEPS.reduce((sum, s) => sum + stepSeconds(s, f), 0);
}

/** Check a custom format. Returns a list of problems (empty = fine). */
export function validateFormat(f: TimeFormat): string[] {
  const problems: string[] = [];
  if (!f.name.trim()) problems.push('Give the format a name.');
  const check = (label: string, v: number, max: number) => {
    if (!Number.isFinite(v) || v <= 0) problems.push(`${label} must be more than zero.`);
    else if (v > max) problems.push(`${label} is longer than ${max / 60} minutes. Is that a typo?`);
  };
  check('Constructive time', f.constructive, 30 * MIN);
  check('Cross-examination time', f.cx, 15 * MIN);
  check('Rebuttal time', f.rebuttal, 30 * MIN);
  if (!Number.isFinite(f.prep) || f.prep < 0) problems.push('Prep time cannot be negative.');
  else if (f.prep > 30 * MIN) problems.push('Prep time is longer than 30 minutes. Is that a typo?');
  return problems;
}
