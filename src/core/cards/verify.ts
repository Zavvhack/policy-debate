// VERBATIM PROTECTION
// ===================
// The rule: a card's text must match its source exactly. AI may only choose
// which words to mark; it may never supply the words.
//
// How that is guaranteed:
//
//  1. Cards are BUILT from the source. cutFromSource() below copies characters
//     out of the source text by position. There is no code path that takes
//     card text from anywhere else (see cutter.ts for the AI side: the model
//     returns word numbers, never words).
//
//  2. Cards are CHECKED against the source. verifyCard() compares the card's
//     text with the source character for character, and is run when a card is
//     cut, when it is opened, and before it is exported. A card that fails is
//     rejected (when cutting) or flagged in red (if it somehow changed later).
//
//  3. Editing a card can only change its marks (see text.ts), never its text.
//
// "Exactly" means exactly: no fixing typos, no straightening quotes, no
// collapsing spaces. The comparison is plain string equality.

import type { Card, Mark, SourceDoc } from '../../data/schema';
import { marksToLevels, normalizeMarks, snapToWords } from './text';

export type VerifyStatus =
  /** The text matches the source exactly. */
  | 'verified'
  /** The text does NOT match the source. The card must not be used. */
  | 'mismatch'
  /** There is no source on file (an imported card), so nothing can be checked. */
  | 'no-source';

export interface VerifyResult {
  status: VerifyStatus;
  /** Things that are wrong (status 'mismatch'). */
  errors: string[];
  /** Things worth a look, which do not make the card invalid. */
  warnings: string[];
  /** Where the card starts in the source, when verified. */
  start: number | null;
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/** Ends a sentence: . ! ? optionally followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/**
 * Check a card against the full text of its source.
 *
 * @param text    the card's body
 * @param start   where the card claims to start in the source
 * @param source  the source's full text, or null if there is none on file
 */
export function verifyText(text: string, start: number, source: string | null): VerifyResult {
  if (source === null) return { status: 'no-source', errors: [], warnings: [], start: null };
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!text.trim()) {
    return { status: 'mismatch', errors: ['The card has no text.'], warnings, start: null };
  }

  // The card must be an exact, unbroken copy of part of the source.
  let at = Number.isInteger(start) && start >= 0 && source.slice(start, start + text.length) === text ? start : -1;
  if (at < 0) at = source.indexOf(text); // same words somewhere else in the source is still verbatim
  if (at < 0) {
    return {
      status: 'mismatch',
      errors: ['The card text does not match the source word for word.' + describeDifference(text, source)],
      warnings,
      start: null,
    };
  }
  const end = at + text.length;

  // It must not start or stop in the middle of a word.
  if (!isSpace(source[at - 1]) && !isSpace(text[0])) errors.push('The card starts in the middle of a word.');
  if (!isSpace(source[end]) && !isSpace(text[text.length - 1])) errors.push('The card ends in the middle of a word.');

  // Starting or stopping mid-sentence is allowed but risky: it can cut a "not" off the front.
  const before = source.slice(Math.max(0, at - 200), at).replace(/[ \t]+$/, '');
  if (before.length && !before.endsWith('\n') && !SENTENCE_END.test(before)) {
    warnings.push('The card starts part-way through a sentence. Check that the missing start does not change the meaning.');
  }
  const body = text.trimEnd();
  const after = source.slice(end, end + 200).replace(/^[ \t]+/, '');
  if (!SENTENCE_END.test(body) && after.length && !after.startsWith('\n')) {
    warnings.push('The card ends part-way through a sentence. Check that the missing end does not change the meaning.');
  }

  return { status: errors.length ? 'mismatch' : 'verified', errors, warnings, start: at };
}

/** A short hint about where two texts first differ, to help find the problem. */
function describeDifference(text: string, source: string): string {
  // Find the longest opening of the card that does appear in the source.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (source.includes(text.slice(0, mid))) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return ' None of it was found in the source.';
  const snippet = text.slice(Math.max(0, lo - 30), lo + 20).replace(/\s+/g, ' ');
  return ` It stops matching near: "…${snippet}…"`;
}

/** Check a saved card. `source` is the SourceDoc it was cut from, if there is one. */
export function verifyCard(card: Pick<Card, 'text' | 'source'>, source: Pick<SourceDoc, 'text'> | null | undefined): VerifyResult {
  if (!card.source || !source) return verifyText(card.text, 0, null);
  return verifyText(card.text, card.source.start, source.text);
}

// ---------------------------------------------------------------------------
// Building a card from the source
// ---------------------------------------------------------------------------

export interface Cut {
  /** Exact characters copied from the source. */
  text: string;
  /** Where they start in the source. */
  start: number;
  marks: Mark[];
}

/**
 * Cut characters [s, e) out of a source. The range is widened to whole words
 * and surrounding spaces are dropped, so a sloppy selection still gives a clean
 * card. Returns null if the range holds no words.
 *
 * THIS is the only place card text is created: by slicing the source.
 */
export function cutFromSource(source: string, s: number, e: number): Cut | null {
  const range = snapToWords(source, s, e);
  if (!range) return null;
  return { text: source.slice(range.s, range.e), start: range.s, marks: [] };
}

// ---------------------------------------------------------------------------
// Highlighting checks ("lint")
// ---------------------------------------------------------------------------

const NEGATIONS = new Set([
  'not', 'no', 'never', 'none', 'nor', 'neither', 'cannot', 'without', 'hardly', 'barely', 'scarcely', 'unlikely', 'nothing', 'nobody', 'nowhere',
]);

function isNegation(word: string): boolean {
  const w = word.toLowerCase().replace(/^[^a-z]+|[^a-z']+$/g, '').replace(/’/g, "'");
  return NEGATIONS.has(w) || w.endsWith("n't");
}

/**
 * Warnings about highlighting that could misrepresent the author. These never
 * block a card - highlighting is the debater's judgement - but they are shown
 * so that nothing slips through unnoticed.
 */
export function lintHighlights(text: string, marks: readonly Mark[]): string[] {
  const levels = marksToLevels(text.length, normalizeMarks(text, marks));
  const warnings: string[] = [];
  const read = (i: number) => levels[i] >= 2;

  // 1. A highlight that starts or stops inside a word turns it into a different word.
  const partial: string[] = [];
  // 2. A negation that is skipped while words on both sides of it, in the same sentence, are read.
  const skipped: string[] = [];

  const words: { s: number; e: number; any: boolean; all: boolean; neg: boolean; endsSentence: boolean }[] = [];
  const re = /\S+/g;
  for (let m; (m = re.exec(text)); ) {
    const s = m.index;
    const e = s + m[0].length;
    let any = false;
    let all = true;
    for (let i = s; i < e; i++) {
      // Punctuation at the edges of a word does not count as "part of the word".
      if (!/[\p{L}\p{N}]/u.test(text[i])) continue;
      if (read(i)) any = true;
      else all = false;
    }
    if (any && !all && partial.length < 4) partial.push(m[0]);
    words.push({ s, e, any, all, neg: isNegation(m[0]), endsSentence: /[.!?]["'”’)\]]*$/.test(m[0]) });
  }

  let sentenceStart = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.neg && !w.any) {
      const readBefore = words.slice(sentenceStart, i).some((x) => x.any);
      let readAfter = false;
      for (let j = i + 1; j < words.length; j++) {
        if (words[j].any) readAfter = true;
        if (words[j].endsSentence || readAfter) break;
      }
      if (readBefore && readAfter && !w.endsSentence && skipped.length < 4) {
        const from = words[Math.max(sentenceStart, i - 3)].s;
        const to = words[Math.min(words.length - 1, i + 3)].e;
        skipped.push(text.slice(from, to).replace(/\s+/g, ' '));
      }
    }
    if (w.endsSentence) sentenceStart = i + 1;
  }

  if (skipped.length) {
    warnings.push(
      `The highlighting skips a negative word while reading around it, which can reverse the author's meaning: ${skipped.map((s) => `"…${s}…"`).join('; ')}`,
    );
  }
  if (partial.length) {
    warnings.push(`Only part of a word is highlighted (${partial.map((p) => `"${p}"`).join(', ')}). Reading part of a word can change what the author wrote.`);
  }
  return warnings;
}
