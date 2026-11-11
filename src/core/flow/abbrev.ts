// Your own flowing abbreviations.
//
// You define short codes ("nu") and what they expand to ("non-unique").
// While you type on the flow, a code is replaced the moment you finish the
// word (space, punctuation, or Enter). Codes are matched exactly, including
// capital letters, so "T" and "t" can mean different things.

export interface Abbreviation {
  code: string;
  expansion: string;
}

/** A small starter list. Nothing is active until you load or add entries in Settings. */
export const STARTER_ABBREVIATIONS: readonly Abbreviation[] = [
  { code: 'nu', expansion: 'non-unique' },
  { code: 'nl', expansion: 'no link' },
  { code: 'lt', expansion: 'link turn' },
  { code: 'it', expansion: 'impact turn' },
  { code: 'ni', expansion: 'no impact' },
  { code: 'nil', expansion: 'no internal link' },
  { code: 'tc', expansion: 'turns case' },
  { code: 'ow', expansion: 'outweighs' },
  { code: 'xt', expansion: 'extend' },
  { code: 'dr', expansion: 'dropped' },
  { code: 'wm', expansion: 'we meet' },
  { code: 'ci', expansion: 'counter-interp' },
  { code: 'pdb', expansion: 'perm do both' },
  { code: 'cond', expansion: 'conditionality' },
  { code: 'sq', expansion: 'status quo' },
  { code: 'solv', expansion: 'solvency' },
  { code: 'inh', expansion: 'inherency' },
  { code: 'usfg', expansion: 'USFG' },
];

/** Characters that end a word. */
const BOUNDARY = /[\s.,;:!?)\]]/;

/**
 * Call this right after the user types a character.
 *
 * If the character at `caret - 1` ends a word and the word just before it is
 * one of the codes, returns the new text and caret position. Otherwise null.
 */
export function expandAtCaret(
  text: string,
  caret: number,
  abbreviations: readonly Abbreviation[],
): { text: string; caret: number } | null {
  if (caret < 2 || !abbreviations.length) return null;
  const typed = text[caret - 1];
  if (!BOUNDARY.test(typed)) return null;
  // Find the start of the word that was just finished.
  let start = caret - 1;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  const word = text.slice(start, caret - 1);
  if (!word) return null;
  const hit = abbreviations.find((a) => a.code === word);
  if (!hit || !hit.expansion) return null;
  const next = text.slice(0, start) + hit.expansion + text.slice(caret - 1);
  return { text: next, caret: start + hit.expansion.length + 1 };
}

/** Expand a code when the cell is finished (Enter/Tab) and the text ends with a code. */
export function expandAtEnd(text: string, abbreviations: readonly Abbreviation[]): string {
  const result = expandAtCaret(text + ' ', text.length + 1, abbreviations);
  return result ? result.text.slice(0, -1) : text;
}

/** Remove empty rows and duplicate codes (the first one wins). */
export function cleanAbbreviations(list: readonly Abbreviation[]): Abbreviation[] {
  const seen = new Set<string>();
  const out: Abbreviation[] = [];
  for (const a of list) {
    const code = a.code.trim();
    const expansion = a.expansion.trim();
    if (!code || !expansion || /\s/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, expansion });
  }
  return out;
}
