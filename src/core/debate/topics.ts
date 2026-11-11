// The topic that ships with the app, and the settings a new install starts with.
//
// Topics are DATA: this file only provides the first one. Add next year's in
// the app (Settings -> Topics); nothing in the code depends on the wording.

import type { Settings, Topic } from '../../data/schema';
import { DEFAULT_FORMAT_ID } from './formats';

export const DEFAULT_TOPIC_ID = 'topic-2026-27-nhi';

/**
 * 2026-27 national high school policy topic.
 *
 * Checked on 2026-11-10:
 *  - Wording: NFHS announcement, 12 January 2026 (ballot: Health Insurance 23, Nuclear Weapons 8).
 *  - Novice case limits: NFHS "2026-2027 Policy Debate Novice Case List", 18 March 2026.
 *    That page says "four topics" but lists only the three below. If your league
 *    hands out a fourth, add it in Settings -> Topics.
 */
export function defaultTopic(now: number): Topic {
  return {
    id: DEFAULT_TOPIC_ID,
    createdAt: now,
    updatedAt: now,
    builtIn: true,
    name: '2026-27 National Health Insurance',
    season: '2026-27',
    resolution: 'Resolved: The United States federal government should establish national health insurance in the United States.',
    keyTerms: [
      'Resolved',
      'The United States federal government',
      'should',
      'establish',
      'national',
      'health insurance',
      'national health insurance',
      'in the United States',
    ],
    noviceLimits: [
      {
        name: 'Medicare for All',
        description:
          'A single-payer, government-run system eliminating private insurance to cover everyone. It would be based on the current Medicare model.',
      },
      {
        name: 'Revise/Expand the Affordable Care Act',
        description:
          'Strengthens the 2010 Affordable Care Act, likely by strengthening the individual mandate and restoring federal subsidies for marketplace health insurance plans.',
      },
      {
        name: 'Single Payer Option to Replace Private Health Insurance',
        description:
          'Also a single-payer, government-run system eliminating private insurance to cover everyone, but not necessarily based on the existing Medicare model.',
      },
    ],
    noviceNote:
      'From the NFHS novice case list (18 March 2026). The NFHS page says there are four limits but lists three; the full breakdown is in the NFHS Policy Debate Quarterly, numbers 3 and 4. Novice limits are optional: check whether your league or tournament uses them.',
    notes: '',
    sources: [
      {
        label: 'NFHS topic announcement (12 Jan 2026)',
        url: 'https://nfhs.org/stories/nfhs-announces-health-insurance-to-be-2026-27-national-high-school-policy-debate-topic',
      },
      {
        label: 'NFHS novice case list (18 Mar 2026)',
        url: 'https://www.nfhs.org/stories/2026-2027-policy-debate-novice-case-list-for-health-insurance-',
      },
      { label: 'NSDA current topics', url: 'https://www.speechanddebate.org/topics/' },
    ],
  };
}

export function defaultSettings(): Settings {
  return {
    id: 'settings',
    theme: 'system',
    textScale: 1,
    initials: '',
    activeTopicId: DEFAULT_TOPIC_ID,
    highlight: {
      mode: 'custom',
      // Light shades that black text stays readable on: red/pink for neg, blue for aff.
      negColor: '#ff9e9e',
      affColor: '#8fd3ff',
      // Word's own "Blue" highlighter is too dark to read through, so aff uses Cyan (turquoise).
      negWord: 'red',
      affWord: 'cyan',
      unreadPt: 7,
    },
    timer: {
      formatId: DEFAULT_FORMAT_ID,
      customFormats: [],
      warningSec: 30,
      sound: true,
      vibrate: true,
      flash: true,
    },
    flow: {
      mergeBlock: false,
      abbreviations: [],
      fontPx: 14,
      dropHints: true,
    },
    ai: {
      fastModel: 'claude-haiku-5-5',
      strongModel: 'claude-opus-5-5',
      rememberKey: false,
      show: true,
    },
    seenWelcome: false,
    backup: { lastFileExportAt: 0 },
  };
}

/**
 * Fill in anything missing from saved settings (e.g. after an update added a
 * new option) without touching what the user already chose.
 */
export function mergeSettings(saved: unknown): Settings {
  const base = defaultSettings();
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<Settings>;
  const pick = <T extends object>(def: T, val: unknown): T => (val && typeof val === 'object' ? { ...def, ...(val as Partial<T>) } : def);
  // Settings can come from an older version or a hand-edited backup, so every
  // value a screen relies on is checked and replaced by the default if it is not usable.
  const number = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
  const text = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
  const flag = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const colour = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : def);
  const highlight = pick(base.highlight, s.highlight);
  const timer = pick(base.timer, s.timer);
  const flow = pick(base.flow, s.flow);
  const ai = pick(base.ai, s.ai);
  const backup = pick(base.backup, s.backup);
  return {
    ...base,
    ...s,
    id: 'settings',
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system',
    textScale: number(s.textScale, base.textScale, 0.75, 2),
    initials: text(s.initials, base.initials),
    activeTopicId: text(s.activeTopicId, base.activeTopicId),
    highlight: {
      ...highlight,
      mode: highlight.mode === 'word' ? 'word' : 'custom',
      negColor: colour(highlight.negColor, base.highlight.negColor),
      affColor: colour(highlight.affColor, base.highlight.affColor),
      negWord: text(highlight.negWord, base.highlight.negWord) as Settings['highlight']['negWord'],
      affWord: text(highlight.affWord, base.highlight.affWord) as Settings['highlight']['affWord'],
      unreadPt: number(highlight.unreadPt, base.highlight.unreadPt, 4, 14),
    },
    timer: {
      ...timer,
      formatId: text(timer.formatId, base.timer.formatId),
      customFormats: Array.isArray(timer.customFormats)
        ? timer.customFormats.filter((f) => f && typeof f === 'object' && typeof f.id === 'string' && [f.constructive, f.cx, f.rebuttal, f.prep].every((n) => typeof n === 'number' && n > 0))
        : [],
      warningSec: number(timer.warningSec, base.timer.warningSec, 0, 600),
      sound: flag(timer.sound, base.timer.sound),
      vibrate: flag(timer.vibrate, base.timer.vibrate),
      flash: flag(timer.flash, base.timer.flash),
    },
    flow: {
      ...flow,
      mergeBlock: flag(flow.mergeBlock, base.flow.mergeBlock),
      abbreviations: Array.isArray(flow.abbreviations)
        ? flow.abbreviations.filter((a) => a && typeof a === 'object' && Object.values(a).every((v) => typeof v === 'string'))
        : [],
      fontPx: number(flow.fontPx, base.flow.fontPx, 10, 28),
      dropHints: flag(flow.dropHints, base.flow.dropHints),
    },
    ai: {
      ...ai,
      fastModel: text(ai.fastModel, base.ai.fastModel),
      strongModel: text(ai.strongModel, base.ai.strongModel),
      rememberKey: flag(ai.rememberKey, base.ai.rememberKey),
      show: flag(ai.show, base.ai.show),
    },
    seenWelcome: flag(s.seenWelcome, base.seenWelcome),
    backup: { ...backup, lastFileExportAt: number(backup.lastFileExportAt, 0, 0, Number.MAX_SAFE_INTEGER) },
  };
}
