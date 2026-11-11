// VERBATIM PROTECTION
// A card's text must match its source exactly, and AI can only pick words by
// number. These tests try hard to break that.
import { describe, expect, it } from 'vitest';
import { applyWordPlan, numberWords, PlanError, planDensity, renderNumbered, validatePlan } from '../../src/core/cards/cutter';
import { cutFromSource, lintHighlights, verifyCard, verifyText } from '../../src/core/cards/verify';
import {
  cardStats,
  cycleWord,
  levelsToMarks,
  marksToLevels,
  normalizeMarks,
  parseTagMarkup,
  readAloudText,
  setLevel,
  tagToMarkup,
  toParagraphs,
} from '../../src/core/cards/text';
import {
  citeFromMeta,
  citeToText,
  dropFields,
  emptyCite,
  extractPageMeta,
  formatCite,
  shortCite,
  splitName,
  unverifiedCiteFields,
} from '../../src/core/cards/cite';

const ARTICLE = `Why coverage gaps persist
By Dr. Maria Okafor, professor of health policy at Example University
January 28, 2026 — The Example Review

Roughly 26 million Americans remain uninsured. That number is not falling. Subsidies that expired in 2025 pushed premiums up by “double digits” in most states — and enrollment dropped.

A single-payer system would not eliminate every cost. It would, however, cut administrative spending by an estimated $500 billion a year, according to the nonpartisan budget office. Critics say that estimate isn’t reliable.

Hospitals in rural areas can’t absorb more uncompensated care.`;

describe('verifying a card against its source', () => {
  const para = 'Roughly 26 million Americans remain uninsured. That number is not falling.';
  const at = ARTICLE.indexOf(para);

  it('accepts an exact copy', () => {
    const r = verifyText(para, at, ARTICLE);
    expect(r).toMatchObject({ status: 'verified', errors: [], start: at });
  });

  it('accepts an exact copy even if the recorded position is wrong', () => {
    expect(verifyText(para, 3, ARTICLE)).toMatchObject({ status: 'verified', start: at });
  });

  const tamper: [string, string][] = [
    ['one word changed', para.replace('26 million', '36 million')],
    ['a word removed', para.replace(' not', '')],
    ['a word added', para.replace('remain', 'still remain')],
    ['words reordered', para.replace('Americans remain', 'remain Americans')],
    ['a typo "fixed"', para.replace('uninsured', 'un-insured')],
    ['punctuation changed', para.replace('uninsured.', 'uninsured;')],
    ['an ellipsis inserted', para.replace(' remain uninsured. That number', ' … That number')],
    ['capitalisation changed', para.replace('That', 'that')],
    ['two spaces instead of one', para.replace('million Americans', 'million  Americans')],
    ['curly quote straightened', '“double digits”'.replace('“', '"') + ' in most states'],
    ['a dash swapped', 'in most states - and enrollment dropped.'],
    ['a look-alike letter', para.replace('Americans', 'Аmericans')], // Cyrillic A
    ['an invisible character added', para.replace('million', 'mil​lion')],
    ['two separate sentences spliced together', 'Roughly 26 million Americans remain uninsured. Hospitals in rural areas can’t absorb more uncompensated care.'],
  ];
  for (const [name, text] of tamper) {
    it(`rejects: ${name}`, () => {
      const r = verifyText(text, at, ARTICLE);
      expect(r.status).toBe('mismatch');
      expect(r.errors[0]).toMatch(/does not match the source word for word/);
    });
  }

  it('says where the text stops matching', () => {
    const r = verifyText(para.replace('not falling', 'now falling'), at, ARTICLE);
    expect(r.errors[0]).toContain('That number is');
  });

  it('rejects a card that starts or ends inside a word', () => {
    const s = ARTICLE.indexOf('insured. That number');
    expect(verifyText('insured. That number is not falling.', s, ARTICLE).errors).toContain('The card starts in the middle of a word.');
    const e = ARTICLE.indexOf('That number is not fall');
    expect(verifyText('That number is not fall', e, ARTICLE).errors).toContain('The card ends in the middle of a word.');
  });

  it('warns when the cut drops the start of a sentence (it could hide a "not")', () => {
    const text = 'eliminate every cost.';
    const r = verifyText(text, ARTICLE.indexOf(text), ARTICLE);
    expect(r.status).toBe('verified');
    expect(r.warnings.join(' ')).toMatch(/starts part-way through a sentence/);
    const tail = 'A single-payer system would not eliminate';
    expect(verifyText(tail, ARTICLE.indexOf(tail), ARTICLE).warnings.join(' ')).toMatch(/ends part-way through a sentence/);
    // A clean sentence-to-sentence cut has no warnings.
    expect(verifyText(para, at, ARTICLE).warnings).toEqual([]);
  });

  it('rejects an empty card, and says "no source" when there is nothing to check against', () => {
    expect(verifyText('   ', 0, ARTICLE).status).toBe('mismatch');
    expect(verifyText(para, 0, null).status).toBe('no-source');
    expect(verifyCard({ text: para, source: null }, null).status).toBe('no-source');
    expect(verifyCard({ text: para, source: { sourceId: 's', start: at } }, { text: ARTICLE }).status).toBe('verified');
    expect(verifyCard({ text: para, source: { sourceId: 's', start: at } }, { text: 'a different article' }).status).toBe('mismatch');
  });

  it('handles emoji and other characters outside the basic plane', () => {
    const src = 'Costs rose 🚀 fast. Then 𝒳 happened, and nothing else did.';
    const cut = cutFromSource(src, src.indexOf('Then'), src.length)!;
    expect(verifyText(cut.text, cut.start, src).status).toBe('verified');
    expect(cut.text).toBe('Then 𝒳 happened, and nothing else did.');
  });
});

describe('cutting by hand', () => {
  it('copies straight from the source, widened to whole words', () => {
    const s = ARTICLE.indexOf('million Amer');
    const cut = cutFromSource(ARTICLE, s + 2, s + 12)!; // "llion Amer"
    expect(cut.text).toBe('million Americans');
    expect(ARTICLE.slice(cut.start, cut.start + cut.text.length)).toBe(cut.text);
    expect(cutFromSource(ARTICLE, 5, 5)).toBeNull(); // nothing selected
    expect(cutFromSource('a   b', 1, 4)).toBeNull(); // only spaces
  });
});

describe('AI cutting: the model answers with word numbers, never words', () => {
  const words = numberWords(ARTICLE);

  it('numbers every word and can always rebuild the exact text', () => {
    expect(words.map((w) => ARTICLE.slice(w.s, w.e)).join(' ')).toBe(ARTICLE.split(/\s+/).join(' '));
    const shown = renderNumbered(ARTICLE, words);
    expect(shown).toContain('Roughly‹');
    expect(shown.match(/‹\d+›/g)).toHaveLength(words.length);
  });

  const first = words.findIndex((w) => ARTICLE.slice(w.s, w.e) === 'Roughly');
  const last = words.findIndex((w) => ARTICLE.slice(w.s, w.e) === 'dropped.');

  it('builds a card that is an exact slice of the source, whatever the marks', () => {
    const plan = validatePlan(
      { start: first, end: last, spans: [{ from: first, to: first + 5, level: 'u' }, { from: first + 1, to: first + 3, level: 'h' }, { from: first + 5, to: first + 5, level: 'e' }] },
      words.length,
    );
    const cut = applyWordPlan(ARTICLE, words, plan);
    expect(cut.text).toBe(ARTICLE.slice(words[first].s, words[last].e));
    expect(verifyText(cut.text, cut.start, ARTICLE).status).toBe('verified');
    // Marks: "Roughly" underlined, "26 million Americans" highlighted, "remain" underlined, "uninsured." emphasis.
    const paras = toParagraphs(cut.text, cut.marks);
    expect(paras[0].runs.slice(0, 4).map((r) => [r.t, r.lv])).toEqual([
      ['Roughly ', 1],
      ['26 million Americans', 2],
      [' remain ', 1],
      ['uninsured.', 3],
    ]);
    expect(planDensity(plan)).toBeGreaterThan(0);
  });

  it('a lower level never erases a higher one, in either order', () => {
    const a = applyWordPlan(ARTICLE, words, validatePlan({ start: first, end: last, spans: [{ from: first, to: first + 4, level: 'h' }, { from: first, to: first + 9, level: 'u' }] }, words.length));
    const b = applyWordPlan(ARTICLE, words, validatePlan({ start: first, end: last, spans: [{ from: first, to: first + 9, level: 'u' }, { from: first, to: first + 4, level: 'h' }] }, words.length));
    expect(a.marks).toEqual(b.marks);
  });

  it('marks outside the card are clipped, not trusted', () => {
    const plan = validatePlan({ start: first, end: last, spans: [{ from: 0, to: words.length - 1, level: 'h' }] }, words.length);
    expect(plan.spans).toEqual([{ from: first, to: last, level: 'h' }]);
  });

  const bad: [string, unknown][] = [
    ['not an object', 'cut it'],
    ['null', null],
    ['range past the end', { start: 0, end: words.length, spans: [] }],
    ['negative start', { start: -1, end: 20, spans: [] }],
    ['back to front', { start: 30, end: 10, spans: [] }],
    ['fractional index', { start: 1.5, end: 20, spans: [] }],
    ['text instead of a number', { start: 'Roughly', end: 20, spans: [] }],
    ['too short', { start: 0, end: 3, spans: [] }],
    ['no spans list', { start: 0, end: 20 }],
    ['span out of range', { start: 0, end: 20, spans: [{ from: 0, to: 99999, level: 'h' }] }],
    ['span back to front', { start: 0, end: 20, spans: [{ from: 9, to: 2, level: 'h' }] }],
    ['unknown level', { start: 0, end: 20, spans: [{ from: 1, to: 2, level: 'bold' }] }],
    ['a smuggled text field is ignored but the rest must still be valid', { start: 0, end: 20, text: 'made up words', spans: [null] }],
  ];
  for (const [name, plan] of bad) {
    it(`rejects a bad plan: ${name}`, () => {
      expect(() => validatePlan(plan, words.length)).toThrow(PlanError);
    });
  }

  it('there is nothing in a valid plan that could carry replacement text', () => {
    const plan = validatePlan({ start: first, end: last, spans: [], text: 'INVENTED', tag: 'x' } as unknown, words.length);
    expect(Object.keys(plan).sort()).toEqual(['end', 'spans', 'start']);
    expect(JSON.stringify(applyWordPlan(ARTICLE, words, plan))).not.toContain('INVENTED');
  });
});

describe('formatting never touches the text', () => {
  const text = 'Costs rose sharply.\nWages did not keep up.';

  it('marks round-trip through levels', () => {
    const marks = [{ s: 0, e: 5, lv: 1 as const }, { s: 6, e: 10, lv: 2 as const }, { s: 11, e: 19, lv: 3 as const }];
    expect(levelsToMarks(marksToLevels(text.length, marks))).toEqual(marks);
  });

  it('survives hundreds of random edits with the text unchanged and marks always valid', () => {
    let marks = normalizeMarks(text, []);
    let seed = 42;
    const rnd = (n: number) => (seed = (seed * 1664525 + 1013904223) % 4294967296) % n;
    for (let i = 0; i < 400; i++) {
      const a = rnd(text.length + 5) - 2;
      const b = a + rnd(15);
      marks = rnd(3) === 0 ? cycleWord(text, marks, a) : setLevel(text, marks, a, b, rnd(4) as 0 | 1 | 2 | 3);
      let end = 0;
      for (const m of marks) {
        expect(m.s).toBeGreaterThanOrEqual(end);
        expect(m.e).toBeGreaterThan(m.s);
        expect(m.e).toBeLessThanOrEqual(text.length);
        expect([1, 2, 3]).toContain(m.lv);
        end = m.e;
      }
      // What you would see on screen always spells out the original text.
      expect(toParagraphs(text, marks).map((p) => p.runs.map((r) => r.t).join('')).join('\n')).toBe(text);
    }
  });

  it('spaces take the lower level of their neighbours; line breaks are never formatted', () => {
    const marks = setLevel(text, [], 0, text.length, 2);
    const levels = marksToLevels(text.length, marks);
    expect(levels[text.indexOf('\n')]).toBe(0);
    const partial = setLevel(text, [], 0, 6, 2); // "Costs " + nothing after
    expect(partial).toEqual([{ s: 0, e: 5, lv: 2 }]);
  });

  it('clicking a word cycles small -> underline -> highlight -> emphasis -> small', () => {
    let marks = cycleWord(text, [], 7);
    expect(marks).toEqual([{ s: 6, e: 10, lv: 1 }]);
    marks = cycleWord(text, marks, 7);
    marks = cycleWord(text, marks, 7);
    expect(marks).toEqual([{ s: 6, e: 10, lv: 3 }]);
    expect(cycleWord(text, marks, 7)).toEqual([]);
    expect(cycleWord(text, [], 5)).toEqual([]); // a space: nothing happens
  });

  it('counts what is read', () => {
    const marks = setLevel(text, setLevel(text, [], 0, 10, 2), 26, 38, 3);
    expect(readAloudText(text, marks)).toBe('Costs rose did not keep');
    const stats = cardStats(text, marks);
    expect(stats).toMatchObject({ words: 8, readWords: 5, readPercent: 63 });
  });

  it('tags use [[ ]] for underlined phrases', () => {
    const tag = parseTagMarkup('Single payer [[cuts costs]] fast');
    expect(tag).toEqual([{ t: 'Single payer ' }, { t: 'cuts costs', u: true }, { t: ' fast' }]);
    expect(tagToMarkup(tag)).toBe('Single payer [[cuts costs]] fast');
  });
});

describe('highlighting checks', () => {
  const text = 'A single-payer system would not eliminate every cost. It would cut spending.';
  it('flags a skipped negative word', () => {
    let marks = setLevel(text, [], 0, text.indexOf(' not'), 2); // "A single-payer system would"
    marks = setLevel(text, marks, text.indexOf('eliminate'), text.indexOf('.') + 1, 2); // "eliminate every cost."
    expect(readAloudText(text, marks)).toBe('A single-payer system would eliminate every cost.');
    expect(lintHighlights(text, marks).join(' ')).toMatch(/skips a negative word/);
  });
  it('is quiet when the negative is read, or when nothing around it is read', () => {
    expect(lintHighlights(text, setLevel(text, [], 0, text.indexOf('.') + 1, 2))).toEqual([]);
    expect(lintHighlights(text, setLevel(text, [], text.indexOf('It would'), text.length, 2))).toEqual([]);
    expect(lintHighlights(text, [])).toEqual([]);
  });
  it("catches n't contractions", () => {
    const t = 'Hospitals can’t absorb more care today.';
    let marks = setLevel(t, [], 0, 9, 2);
    marks = setLevel(t, marks, t.indexOf('absorb'), t.length, 2);
    expect(lintHighlights(t, marks).join(' ')).toMatch(/skips a negative word/);
  });
  it('flags highlighting only part of a word', () => {
    const t = 'This is unconstitutional and harmful.';
    const s = t.indexOf('constitutional');
    expect(lintHighlights(t, [{ s, e: s + 14, lv: 2 }]).join(' ')).toMatch(/Only part of a word is highlighted \("unconstitutional"\)/);
    // Leaving the full stop out is not "part of a word".
    expect(lintHighlights(t, [{ s: t.indexOf('harmful'), e: t.length - 1, lv: 2 }])).toEqual([]);
  });
});

describe('cites', () => {
  const cite = { ...emptyCite('AB'), first: 'Maria', last: 'Okafor', year: '2026', date: '1/28', quals: 'professor of health policy at Example University', title: 'Why coverage gaps persist', publication: 'The Example Review', url: 'https://example.org/gaps', accessed: '11/10/2026' };

  it('formats with the last name and last two digits of the year marked bold-13pt', () => {
    expect(formatCite(cite)).toEqual([
      { t: 'Maria ' },
      { t: 'Okafor,', big: true },
      { t: ' ' },
      { t: '20' },
      { t: '26', big: true },
      { t: ' – professor of health policy at Example University, “Why coverage gaps persist”, The Example Review, 1/28, https://example.org/gaps, accessed 11/10/2026' },
      { t: ' //AB' },
    ]);
    expect(citeToText(cite)).toMatch(/^Maria Okafor, 2026 – .* \/\/AB$/);
    expect(shortCite(cite)).toBe('Okafor 26');
    expect(citeToText(emptyCite())).toBe('');
    expect(citeToText({ ...emptyCite('//AB'), last: 'KFF' })).toBe('KFF //AB');
  });

  it('every field of a real cite is found in the source', () => {
    expect(unverifiedCiteFields(cite, ARTICLE)).toEqual([]);
  });

  it('flags anything that is not in the source: invented author, date, or qualifications', () => {
    expect(unverifiedCiteFields({ ...cite, first: 'Mark' }, ARTICLE)).toEqual(['first']);
    expect(unverifiedCiteFields({ ...cite, last: 'Okafur' }, ARTICLE)).toEqual(['last']);
    expect(unverifiedCiteFields({ ...cite, year: '2024' }, ARTICLE)).toEqual(['year']);
    expect(unverifiedCiteFields({ ...cite, date: '2/14' }, ARTICLE)).toEqual(['date']);
    expect(unverifiedCiteFields({ ...cite, quals: 'Nobel laureate in economics' }, ARTICLE)).toEqual(['quals']);
    expect(unverifiedCiteFields({ ...cite, title: 'A different title' }, ARTICLE)).toEqual(['title']);
    expect(unverifiedCiteFields({ ...cite, publication: 'The New York Times' }, ARTICLE)).toEqual(['publication']);
    // "202" must not match inside "2026"; "26" must not pass as a year either.
    expect(unverifiedCiteFields({ ...cite, year: '202' }, ARTICLE)).toEqual(['year']);
  });

  it('discards unverified fields and keeps the rest', () => {
    const suggested = { ...cite, quals: 'Nobel laureate', first: 'Mark' };
    const kept = dropFields(suggested, unverifiedCiteFields(suggested, ARTICLE));
    expect(kept.quals).toBe('');
    expect(kept.first).toBe('');
    expect(kept.last).toBe('Okafor');
  });

  it('recognises dates written in different ways', () => {
    for (const body of ['Published Jan. 28, 2026', 'on 28 January 2026', 'date: 2026-01-28', 'updated 01/28/2026']) {
      expect(unverifiedCiteFields({ ...emptyCite(), date: '1/28' }, body)).toEqual([]);
    }
    expect(unverifiedCiteFields({ ...emptyCite(), date: '1/28' }, 'Published January 8, 2026')).toEqual(['date']);
  });

  it('reads cite details from a page’s own metadata', () => {
    const html = `<html><head><title>Fallback title</title>
      <meta property="og:title" content="Why coverage gaps persist">
      <meta name="author" content="Maria Okafor">
      <meta property="article:published_time" content="2026-01-28T09:00:00Z">
      <meta property="og:site_name" content="The Example Review">
      <script type="application/ld+json">{"@type":"NewsArticle","author":[{"@type":"Person","name":"Maria Okafor"}]}</script>
      </head><body><h1>Why coverage gaps persist</h1></body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = extractPageMeta(doc);
    expect(meta).toEqual({ title: 'Why coverage gaps persist', authors: ['Maria Okafor'], published: '2026-01-28T09:00:00Z', site: 'The Example Review' });
    const filled = citeFromMeta({ ...emptyCite('AB'), quals: 'typed by me' }, meta, 'https://example.org/gaps', new Date(2026, 10, 10).getTime());
    expect(filled).toMatchObject({ first: 'Maria', last: 'Okafor', year: '2026', date: '1/28', title: 'Why coverage gaps persist', publication: 'The Example Review', url: 'https://example.org/gaps', accessed: '11/10/2026', quals: 'typed by me', initials: 'AB' });
  });

  it('falls back to structured data, and never overwrites what you typed', () => {
    const html = `<html><head><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Article","headline":"H","datePublished":"2025-12-03","author":{"name":"A. B. Smith"},"publisher":{"name":"Pub"}}]}</script><script type="application/ld+json">{broken</script></head><body></body></html>`;
    const meta = extractPageMeta(new DOMParser().parseFromString(html, 'text/html'));
    expect(meta).toEqual({ title: 'H', authors: ['A. B. Smith'], published: '2025-12-03', site: 'Pub' });
    expect(citeFromMeta({ ...emptyCite(), last: 'Mine' }, meta, '').last).toBe('Mine');
    expect(splitName('Smith, Jane Q.')).toEqual({ first: 'Jane Q.', last: 'Smith' });
    expect(splitName('By Jane Q. Smith')).toEqual({ first: 'Jane Q.', last: 'Smith' });
    expect(splitName('KFF')).toEqual({ first: '', last: 'KFF' });
  });
});

import { rebuildPageText } from '../../src/core/import/pdf';
import { extractArticle, htmlToText } from '../../src/core/import/html';
import { searchItems, searchScore, searchTerms } from '../../src/core/search';

describe('rebuilding text from a PDF page', () => {
  const line = (str: string, y: number, height = 12) => ({ str, hasEOL: true, y, height });
  it('joins wrapped lines, re-joins hyphenated words, and keeps paragraph breaks', () => {
    const text = rebuildPageText([
      line('Report title', 700, 24),
      line('Roughly 26 million Americans remain unin-', 660),
      line('sured, and costs keep rising', 646),
      line('every year.', 632),
      line('A second paragraph about rural', 604),
      line('hospitals. Well-', 590),
      line('Known facts follow.', 576),
    ]);
    expect(text).toBe('Report title\n\nRoughly 26 million Americans remain uninsured, and costs keep rising every year.\n\nA second paragraph about rural hospitals. Well- Known facts follow.');
  });
  it('joins fragments on one line and treats a jump back up the page as a new block', () => {
    const text = rebuildPageText([
      { str: 'Left ', hasEOL: false, y: 500, height: 10 },
      { str: 'column', hasEOL: true, y: 500, height: 10 },
      line('continues here.', 488, 10),
      line('Right column starts.', 700, 10),
    ]);
    expect(text).toBe('Left column continues here.\n\nRight column starts.');
    expect(rebuildPageText([])).toBe('');
  });
});

describe('reading a web page', () => {
  const html = `<html><head><title>T</title><meta property="og:site_name" content="Example Review"><meta name="author" content="Maria Okafor">
    <script>document.title='hacked'</script></head><body>
    <nav>Home | About | Subscribe</nav>
    <article><h1>Why coverage gaps persist</h1>
    <p>Roughly 26 million Americans remain uninsured. That number is <b>not</b> falling, and it has not fallen for several years according to the survey data.</p>
    <p>Subsidies that expired in 2025 pushed premiums up in most states, and enrollment dropped as a result across every region that was measured.</p>
    <p>A single-payer system would not eliminate every cost. It would, however, cut administrative spending by a large amount, the budget office said.</p>
    <img src="https://tracker.example/pixel.gif" onerror="window.pwned=true"><script>window.pwned=true</script>
    </article><footer>Copyright</footer></body></html>`;
  it('extracts the article text with paragraphs, without running anything on the page', () => {
    const page = extractArticle(html);
    expect(page.text).toContain('Roughly 26 million Americans remain uninsured. That number is not falling, and it has not fallen');
    expect(page.text.split('\n\n').length).toBeGreaterThanOrEqual(3);
    expect(page.text).not.toContain('pwned');
    expect(page.text).not.toContain('Subscribe');
    expect(page.meta.authors).toEqual(['Maria Okafor']);
    expect(page.metaText).toContain('Example Review');
    expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
  });
  it('htmlToText keeps block structure', () => {
    const doc = new DOMParser().parseFromString('<div><p>One <i>two</i></p><ul><li>a</li><li>b</li></ul>three<br>four<style>x{}</style></div>', 'text/html');
    expect(htmlToText(doc.body)).toBe('One two\n\na\n\nb\n\nthree four');
  });
});

describe('library search', () => {
  const items = [
    { tag: 'Single payer cuts costs', body: 'administrative spending falls' },
    { tag: 'Spending causes inflation', body: 'single payer raises deficits' },
    { tag: 'Rural hospitals close', body: 'uncompensated care' },
  ];
  const fields = (i: (typeof items)[number]) => [{ text: i.tag, weight: 5 }, { text: i.body, weight: 1 }];
  it('needs every word, ranks tag matches first, and supports quoted phrases', () => {
    expect(searchItems(items, 'single payer', fields).map((i) => i.tag)).toEqual(['Single payer cuts costs', 'Spending causes inflation']);
    expect(searchItems(items, 'payer hospitals', fields)).toEqual([]);
    expect(searchItems(items, '"payer raises"', fields).map((i) => i.tag)).toEqual(['Spending causes inflation']);
    expect(searchItems(items, '  ', fields)).toHaveLength(3);
    expect(searchTerms('Econ "link turn" DA')).toEqual(['econ', 'link turn', 'da']);
    expect(searchScore([{ text: 'Spending', weight: 1 }], ['pend'])).toBeLessThan(searchScore([{ text: 'Spending', weight: 1 }], ['spend']));
  });
});
