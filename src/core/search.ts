// Full-text search over the library.
//
// Simple and fast enough for thousands of cards: every word of the query must
// appear somewhere in the item; matches in more important fields (the tag,
// the cite) rank higher than matches deep in the body.

/** Split a query into lower-case terms. "double quotes" keep a phrase together. */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  for (let m; (m = re.exec(query.toLowerCase())); ) {
    const t = (m[1] ?? m[2]).trim();
    if (t) terms.push(t);
  }
  return terms;
}

export interface SearchField {
  text: string;
  /** How much a match here is worth. */
  weight: number;
}

/** 0 = not a match. Higher = better match. An empty query matches everything equally. */
export function searchScore(fields: readonly SearchField[], terms: readonly string[]): number {
  if (!terms.length) return 1;
  let score = 0;
  const lowered = fields.map((f) => ({ text: f.text.toLowerCase(), weight: f.weight }));
  for (const term of terms) {
    let best = 0;
    for (const f of lowered) {
      const at = f.text.indexOf(term);
      if (at < 0) continue;
      // A match at the start of a word counts a little more than one inside a word.
      const wordStart = at === 0 || /[^\p{L}\p{N}]/u.test(f.text[at - 1]);
      best = Math.max(best, f.weight * (wordStart ? 1.5 : 1));
    }
    if (!best) return 0; // every term must appear somewhere
    score += best;
  }
  return score;
}

/** Filter and rank items. Ties keep their original order. */
export function searchItems<T>(items: readonly T[], query: string, fieldsOf: (item: T) => SearchField[]): T[] {
  const terms = searchTerms(query);
  if (!terms.length) return [...items];
  return items
    .map((item, i) => ({ item, i, score: searchScore(fieldsOf(item), terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}
