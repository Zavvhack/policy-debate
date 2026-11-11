// Checking quotes in AI-written text.
//
// AI feedback often quotes "the card" or "your speech". A quote that is not
// actually in the text the AI was given is a made-up quote, and in debate a
// made-up quote is the worst kind of mistake. So every quoted passage in AI
// output is looked up in the material the AI was shown, and anything that is
// not there is flagged on screen.

/** Lower-case, straighten quotes/dashes, collapse spaces. */
function loose(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every "quoted passage" of at least `minWords` words in a text. */
export function findQuotes(text: string, minWords = 4): string[] {
  const out: string[] = [];
  const re = /"([^"\n]{8,600})"|“([^”\n]{8,600})”/g;
  for (let m; (m = re.exec(text)); ) {
    const q = (m[1] ?? m[2]).trim();
    if (q.split(/\s+/).length >= minWords) out.push(q);
  }
  return [...new Set(out)];
}

/**
 * Quotes in `aiText` that do not appear in any of the `given` texts.
 * An ellipsis inside a quote is allowed: each piece must appear, in order.
 */
export function unverifiedQuotes(aiText: string, given: readonly string[], minWords = 4): string[] {
  const haystack = loose(given.join('\n\n'));
  return findQuotes(aiText, minWords).filter((quote) => {
    const pieces = loose(quote)
      .replace(/[.,;:!?]+$/, '')
      .split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 2);
    let from = 0;
    for (const piece of pieces) {
      const at = haystack.indexOf(piece, from);
      if (at < 0) return true;
      from = at + piece.length;
    }
    return pieces.length === 0;
  });
}
