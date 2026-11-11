// Card text and its formatting.
//
// A card's body is stored as two separate things:
//
//   text  - the exact words from the source. Nothing in this file (or anywhere
//           in the app) changes it after the card is cut.
//   marks - which stretches of that text are underlined / highlighted / emphasised.
//
// Keeping them apart is what makes the verbatim guarantee simple: highlighting
// can only ever change `marks`, so it cannot alter a single character of evidence.

import type { Level, Mark } from '../../data/schema';

/** One level per character of the text. */
export function marksToLevels(length: number, marks: readonly Mark[]): Uint8Array {
  const levels = new Uint8Array(length);
  for (const m of marks) {
    const s = Math.max(0, Math.min(length, Math.floor(m.s)));
    const e = Math.max(s, Math.min(length, Math.floor(m.e)));
    if (m.lv >= 1 && m.lv <= 3) levels.fill(m.lv, s, e);
  }
  return levels;
}

/** The shortest list of marks that describes these levels. */
export function levelsToMarks(levels: Uint8Array): Mark[] {
  const marks: Mark[] = [];
  let start = 0;
  for (let i = 1; i <= levels.length; i++) {
    if (i === levels.length || levels[i] !== levels[start]) {
      const lv = levels[start];
      if (lv >= 1 && lv <= 3) marks.push({ s: start, e: i, lv: lv as 1 | 2 | 3 });
      start = i;
    }
  }
  return marks;
}

const isSpace = (ch: string) => /\s/.test(ch);

/**
 * Tidy the formatting of spaces: a space between two words takes the LOWER of
 * its neighbours' levels, so underlining never dangles off the end of a phrase
 * and a highlight never bridges two words that are not both highlighted.
 * Line breaks are never formatted.
 */
export function tidyLevels(text: string, levels: Uint8Array): Uint8Array {
  const out = levels.slice();
  let i = 0;
  while (i < text.length) {
    if (!isSpace(text[i])) {
      i++;
      continue;
    }
    let j = i;
    let hasBreak = false;
    while (j < text.length && isSpace(text[j])) {
      if (text[j] === '\n') hasBreak = true;
      j++;
    }
    const before = i > 0 ? levels[i - 1] : 0;
    const after = j < text.length ? levels[j] : 0;
    out.fill(hasBreak ? 0 : Math.min(before, after), i, j);
    i = j;
  }
  return out;
}

/** Marks cleaned up: in range, tidy spaces, merged. Safe to call on anything. */
export function normalizeMarks(text: string, marks: readonly Mark[]): Mark[] {
  return levelsToMarks(tidyLevels(text, marksToLevels(text.length, marks)));
}

/** Set characters [s, e) to a level. Returns new marks; the text is not touched. */
export function setLevel(text: string, marks: readonly Mark[], s: number, e: number, lv: Level): Mark[] {
  const levels = marksToLevels(text.length, marks);
  const from = Math.max(0, Math.min(text.length, s));
  const to = Math.max(from, Math.min(text.length, e));
  levels.fill(lv, from, to);
  return levelsToMarks(tidyLevels(text, levels));
}

/** The start and end of the word around `offset` (a word = a run of non-space characters). */
export function wordAt(text: string, offset: number): { s: number; e: number } | null {
  let at = Math.max(0, Math.min(text.length - 1, offset));
  if (!text.length || isSpace(text[at])) return null;
  let s = at;
  while (s > 0 && !isSpace(text[s - 1])) s--;
  while (at < text.length && !isSpace(text[at])) at++;
  return { s, e: at };
}

/** Widen [s, e) so it starts and ends on whole words, and drop surrounding spaces. Null if nothing is left. */
export function snapToWords(text: string, s: number, e: number): { s: number; e: number } | null {
  let from = Math.max(0, Math.min(text.length, s));
  let to = Math.max(from, Math.min(text.length, e));
  while (from < to && isSpace(text[from])) from++;
  while (to > from && isSpace(text[to - 1])) to--;
  if (from >= to) return null;
  while (from > 0 && !isSpace(text[from - 1])) from--;
  while (to < text.length && !isSpace(text[to])) to++;
  return { s: from, e: to };
}

/** Click a word to step it to the next level: small -> underline -> highlight -> emphasis -> small. */
export function cycleWord(text: string, marks: readonly Mark[], offset: number): Mark[] {
  const word = wordAt(text, offset);
  if (!word) return [...marks];
  const levels = marksToLevels(text.length, marks);
  // Use the highest level in the word, so a part-highlighted word steps on from there.
  let cur = 0;
  for (let i = word.s; i < word.e; i++) cur = Math.max(cur, levels[i]);
  return setLevel(text, marks, word.s, word.e, ((cur + 1) % 4) as Level);
}

export interface Run {
  /** Offset of this run's first character in the card text. */
  s: number;
  t: string;
  lv: Level;
}

export interface Paragraph {
  runs: Run[];
}

/**
 * The card split into paragraphs (at line breaks) and runs of equal formatting.
 * This is what the screen, the clipboard copy and the .docx export all draw from,
 * so they can never disagree with each other.
 */
export function toParagraphs(text: string, marks: readonly Mark[]): Paragraph[] {
  const levels = marksToLevels(text.length, marks);
  const out: Paragraph[] = [];
  let lineStart = 0;
  const pushLine = (from: number, to: number) => {
    // Trim spaces at the ends of the line; skip blank lines.
    let s = from;
    let e = to;
    while (s < e && isSpace(text[s])) s++;
    while (e > s && isSpace(text[e - 1])) e--;
    if (s >= e) return;
    const runs: Run[] = [];
    let runStart = s;
    for (let i = s + 1; i <= e; i++) {
      if (i === e || levels[i] !== levels[runStart]) {
        runs.push({ s: runStart, t: text.slice(runStart, i), lv: levels[runStart] as Level });
        runStart = i;
      }
    }
    out.push({ runs });
  };
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      pushLine(lineStart, i);
      lineStart = i + 1;
    }
  }
  return out;
}

/** Just the words that are read aloud (highlighted or emphasised), in order. A part-highlighted word reads as its highlighted part. */
export function readAloudText(text: string, marks: readonly Mark[]): string {
  const levels = marksToLevels(text.length, marks);
  const out: string[] = [];
  const re = /\S+/g;
  for (let m; (m = re.exec(text)); ) {
    let piece = '';
    for (let i = m.index; i < m.index + m[0].length; i++) if (levels[i] >= 2) piece += text[i];
    if (piece) out.push(piece);
  }
  return out.join(' ');
}

export interface CardStats {
  words: number;
  /** Words with at least one highlighted character. */
  readWords: number;
  /** Share of the card that is read, 0-100. */
  readPercent: number;
  /** Rough reading time at a brisk 250 words a minute. */
  readSeconds: number;
}

export function cardStats(text: string, marks: readonly Mark[]): CardStats {
  const levels = marksToLevels(text.length, marks);
  let words = 0;
  let readWords = 0;
  const re = /\S+/g;
  for (let m; (m = re.exec(text)); ) {
    words++;
    for (let i = m.index; i < m.index + m[0].length; i++) {
      if (levels[i] >= 2) {
        readWords++;
        break;
      }
    }
  }
  return {
    words,
    readWords,
    readPercent: words ? Math.round((readWords / words) * 100) : 0,
    readSeconds: Math.round((readWords / 250) * 60),
  };
}

/** The tag as plain text. */
export function tagText(tag: readonly { t: string }[]): string {
  return tag.map((p) => p.t).join('');
}

/** "A [[key phrase]] here" -> tag parts with the bracketed phrases underlined. */
export function parseTagMarkup(s: string): { t: string; u?: boolean }[] {
  const parts: { t: string; u?: boolean }[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0;
  for (let m; (m = re.exec(s)); ) {
    if (m.index > last) parts.push({ t: s.slice(last, m.index) });
    parts.push({ t: m[1], u: true });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ t: s.slice(last) });
  return parts.filter((p) => p.t);
}

/** The reverse of parseTagMarkup, for editing a tag in a plain text box. */
export function tagToMarkup(tag: readonly { t: string; u?: boolean }[]): string {
  return tag.map((p) => (p.u ? `[[${p.t}]]` : p.t)).join('');
}
