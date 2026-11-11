// Turning "which words" into a card.
//
// When AI helps cut a card it is never asked to write the card's text. Instead:
//
//   1. numberWords() splits the source into words and numbers them.
//   2. The model is shown the numbered words and answers with NUMBERS ONLY:
//      "the card is words 120-310; underline 130-155; highlight 131-140 ...".
//   3. applyWordPlan() turns those numbers into a card by copying characters
//      out of the source.
//
// So the model has no way to change, add, or drop a word: it never produces
// any. A bad answer (numbers out of range, back to front, not numbers at all)
// is rejected here before a card exists. The result is then checked again by
// verifyText() like every other card.

import type { Mark } from '../../data/schema';
import { levelsToMarks, tidyLevels } from './text';
import type { Cut } from './verify';

export interface Word {
  /** Start offset in the source. */
  s: number;
  /** End offset (exclusive). */
  e: number;
}

/** Every run of non-space characters in the source, in order. */
export function numberWords(source: string): Word[] {
  const words: Word[] = [];
  const re = /\S+/g;
  for (let m; (m = re.exec(source)); ) words.push({ s: m.index, e: m.index + m[0].length });
  return words;
}

/**
 * The source as shown to the model: each word followed by its number, with
 * paragraph breaks kept. Example: "Costs‹0› rose‹1› sharply.‹2›"
 * The markers are only in the prompt; nothing here is ever copied into a card.
 */
export function renderNumbered(source: string, words: readonly Word[]): string {
  let out = '';
  let prev = 0;
  words.forEach((w, i) => {
    const gap = source.slice(prev, w.s);
    if (i > 0) out += /\n\s*\n/.test(gap) ? '\n\n' : gap.includes('\n') ? '\n' : ' ';
    out += `${source.slice(w.s, w.e)}‹${i}›`;
    prev = w.e;
  });
  return out;
}

export type PlanLevel = 'u' | 'h' | 'e';

export interface WordSpan {
  /** First word number (inclusive). */
  from: number;
  /** Last word number (inclusive). */
  to: number;
  /** u = underline, h = highlight, e = emphasis. */
  level: PlanLevel;
}

export interface WordPlan {
  /** First word of the card (inclusive). */
  start: number;
  /** Last word of the card (inclusive). */
  end: number;
  spans: WordSpan[];
}

const LEVEL_NUMBER: Record<PlanLevel, 1 | 2 | 3> = { u: 1, h: 2, e: 3 };

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanError';
  }
}

const isIndex = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < max;

/** Check a plan that came back from the model. Throws PlanError with a reason if it is unusable. */
export function validatePlan(raw: unknown, wordCount: number): WordPlan {
  if (!raw || typeof raw !== 'object') throw new PlanError('The answer was not in the expected form.');
  const p = raw as Partial<WordPlan>;
  if (!isIndex(p.start, wordCount) || !isIndex(p.end, wordCount)) throw new PlanError('The card range points outside the article.');
  if (p.end < p.start) throw new PlanError('The card range is back to front.');
  if (p.end - p.start < 7) throw new PlanError('The card is too short to be useful (under 8 words).');
  if (!Array.isArray(p.spans)) throw new PlanError('The highlighting was missing.');
  const spans: WordSpan[] = [];
  for (const s of p.spans as unknown[]) {
    const span = s as Partial<WordSpan> | null;
    if (!span || !isIndex(span.from, wordCount) || !isIndex(span.to, wordCount) || span.to < span.from) {
      throw new PlanError('A highlighted range points outside the article.');
    }
    if (span.level !== 'u' && span.level !== 'h' && span.level !== 'e') throw new PlanError('A highlighted range has an unknown level.');
    // Marks outside the card are simply clipped to it.
    const from = Math.max(span.from, p.start);
    const to = Math.min(span.to, p.end);
    if (from <= to) spans.push({ from, to, level: span.level });
  }
  return { start: p.start, end: p.end, spans };
}

/**
 * Build the card: copy words [plan.start .. plan.end] out of the source and
 * apply the marks. Later spans win where they overlap, except that a lower
 * level never wipes out a higher one (so "underline 10-40" plus "highlight
 * 12-15" works in either order).
 */
export function applyWordPlan(source: string, words: readonly Word[], plan: WordPlan): Cut {
  const startChar = words[plan.start].s;
  const endChar = words[plan.end].e;
  const text = source.slice(startChar, endChar);
  const levels = new Uint8Array(text.length);
  for (const span of plan.spans) {
    const lv = LEVEL_NUMBER[span.level];
    const s = words[span.from].s - startChar;
    const e = words[span.to].e - startChar;
    for (let i = s; i < e; i++) if (levels[i] < lv) levels[i] = lv;
  }
  const marks: Mark[] = levelsToMarks(tidyLevels(text, levels));
  return { text, start: startChar, marks };
}

/** Share of the card's words that are highlighted, 0-1. Used to tell the user how dense the cut is. */
export function planDensity(plan: WordPlan): number {
  const total = plan.end - plan.start + 1;
  const read = new Set<number>();
  for (const s of plan.spans) if (s.level !== 'u') for (let i = s.from; i <= s.to; i++) read.add(i);
  return total ? read.size / total : 0;
}
