// Citations: formatting them, and checking them against the source.
//
// Format (matches the project's card format):
//
//   First LAST, 20YY – quals, “Title”, Publication, date, url, accessed ..., p. .. //AB
//
// The author's last name and the last two digits of the year are bold 13pt.
// Everything else is 11pt. The cutter's initials come last.

import type { Cite } from '../../data/schema';

export function emptyCite(initials = ''): Cite {
  return { first: '', last: '', year: '', date: '', quals: '', title: '', publication: '', url: '', accessed: '', pages: '', initials };
}

/** A piece of a formatted cite. `big` = bold 13pt (last name, and the last two digits of the year). */
export interface CitePart {
  t: string;
  big?: boolean;
}

export function formatCite(c: Cite): CitePart[] {
  const parts: CitePart[] = [];
  const first = c.first.trim();
  const last = c.last.trim();
  const year = c.year.trim();
  if (first) parts.push({ t: `${first} ` });
  if (last) parts.push({ t: year ? `${last},` : last, big: true });
  if (year) {
    if (last) parts.push({ t: ' ' });
    // "2026" -> "20" + bold "26". A two-digit or odd year is shown whole, in bold.
    if (/^\d{4}$/.test(year)) {
      parts.push({ t: year.slice(0, 2) });
      parts.push({ t: year.slice(2), big: true });
    } else parts.push({ t: year, big: true });
  }
  const rest = [
    c.quals.trim(),
    c.title.trim() ? `“${c.title.trim()}”` : '',
    c.publication.trim(),
    c.date.trim(),
    c.url.trim(),
    c.accessed.trim() ? `accessed ${c.accessed.trim()}` : '',
    c.pages.trim() ? (/^p/i.test(c.pages.trim()) ? c.pages.trim() : `p. ${c.pages.trim()}`) : '',
  ].filter(Boolean);
  if (rest.length) parts.push({ t: `${parts.length ? ' – ' : ''}${rest.join(', ')}` });
  const initials = c.initials.trim().replace(/^\/+/, '');
  if (initials) parts.push({ t: `${parts.length ? ' ' : ''}//${initials}` });
  return parts;
}

export function citeToText(c: Cite): string {
  return formatCite(c)
    .map((p) => p.t)
    .join('');
}

/** What you say aloud: "Smith 26". NSDA requires at least the author's last name and the year. */
export function shortCite(c: Cite): string {
  const year = c.year.trim();
  return [c.last.trim() || c.publication.trim(), /^\d{4}$/.test(year) ? year.slice(2) : year].filter(Boolean).join(' ');
}

/** Today's date as M/D/YYYY, for the "accessed" field. */
export function todayForCite(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Checking a cite against the source
// ---------------------------------------------------------------------------

/** Lower-case, straighten quotes and dashes, collapse spaces: for finding a phrase in a source. */
function loose(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Does a date like "1/28" appear in the text in some form ("January 28", "Jan. 28", "1/28", "28 January", "2026-01-28")? */
function dateAppears(date: string, haystack: string): boolean {
  if (haystack.includes(loose(date))) return true;
  const m = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})/.exec(date.trim());
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return false;
  const name = MONTHS[month - 1];
  const forms = [
    new RegExp(`\\b${name.slice(0, 3)}[a-z]*\\.?\\s+${day}(st|nd|rd|th)?\\b`),
    new RegExp(`\\b${day}(st|nd|rd|th)?\\s+${name.slice(0, 3)}[a-z]*\\b`),
    new RegExp(`\\b0?${month}/0?${day}\\b`),
    new RegExp(`\\b\\d{4}-0?${month}-0?${day}\\b`),
  ];
  return forms.some((re) => re.test(haystack));
}

export const CITE_FIELD_LABEL: Record<keyof Cite, string> = {
  first: 'first name',
  last: 'last name',
  year: 'year',
  date: 'date',
  quals: 'qualifications',
  title: 'title',
  publication: 'publication',
  url: 'link',
  accessed: 'date accessed',
  pages: 'pages',
  initials: 'initials',
};

/**
 * Which cite fields can NOT be found in the source text?
 *
 * This is how the app keeps AI from inventing an author, date, or
 * qualification: anything the AI suggests for a cite is looked up in the
 * article you pasted. Fields that are not there are returned here, and the
 * app either drops them (AI suggestions) or flags them for you to check.
 *
 * Fields you would not expect to find in an article's text (link, date
 * accessed, pages, your initials) are not checked.
 *
 * @param extra  other trusted text to search as well, e.g. the page's own metadata
 */
export function unverifiedCiteFields(cite: Cite, sourceText: string, extra = ''): (keyof Cite)[] {
  const haystack = loose(`${sourceText}\n${extra}`);
  const missing: (keyof Cite)[] = [];
  const has = (value: string) => haystack.includes(loose(value));
  const check = (field: keyof Cite, ok: (value: string) => boolean) => {
    const value = cite[field].trim();
    if (value && !ok(value)) missing.push(field);
  };
  check('first', has);
  check('last', has);
  check('year', (v) => new RegExp(`(^|[^0-9])${v.replace(/[^0-9]/g, '')}([^0-9]|$)`).test(haystack) && /\d/.test(v));
  check('date', (v) => dateAppears(v, haystack));
  check('quals', has);
  check('title', has);
  check('publication', has);
  return missing;
}

/** Remove the listed fields from a cite (used to discard AI suggestions that are not in the source). */
export function dropFields(cite: Cite, fields: readonly (keyof Cite)[]): Cite {
  const out = { ...cite };
  for (const f of fields) out[f] = '';
  return out;
}

// ---------------------------------------------------------------------------
// Reading citation details from a web page (no AI involved)
// ---------------------------------------------------------------------------

export interface PageMeta {
  title: string;
  authors: string[];
  /** ISO date if one was found, e.g. "2026-01-28". */
  published: string;
  site: string;
}

function metaContent(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const v = el?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return '';
}

/** Dig through JSON-LD blocks (the structured data news sites publish) for an Article. */
function jsonLdArticle(doc: Document): Record<string, unknown> | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? '') as unknown;
      const queue: unknown[] = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        if (Array.isArray(obj['@graph'])) queue.push(...(obj['@graph'] as unknown[]));
        const type = ([] as unknown[]).concat(obj['@type'] ?? []).join(' ');
        if (/Article|Report|BlogPosting|ScholarlyArticle/i.test(type)) return obj;
      }
    } catch {
      // Malformed structured data is common; ignore it.
    }
  }
  return null;
}

function namesFrom(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as Record<string, unknown>).name ?? '') : ''))
    .map((s) => s.trim())
    .filter((s) => s && !/^https?:/i.test(s));
}

/** Citation details as published by the page itself, in its meta tags and structured data. */
export function extractPageMeta(doc: Document): PageMeta {
  const ld = jsonLdArticle(doc);
  const title =
    metaContent(doc, ['meta[name="citation_title"]', 'meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    (typeof ld?.headline === 'string' ? ld.headline : '') ||
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.title?.trim() ||
    '';
  let authors = Array.from(doc.querySelectorAll('meta[name="citation_author"], meta[name="author"], meta[property="article:author"], meta[name="parsely-author"], meta[name="dc.creator"], meta[name="DC.creator"]'))
    .map((m) => m.getAttribute('content')?.trim() ?? '')
    .filter((s) => s && !/^https?:/i.test(s));
  if (!authors.length && ld) authors = namesFrom(ld.author);
  const published =
    metaContent(doc, [
      'meta[name="citation_publication_date"]',
      'meta[name="citation_date"]',
      'meta[property="article:published_time"]',
      'meta[name="parsely-pub-date"]',
      'meta[name="dc.date"]',
      'meta[name="DC.date"]',
      'meta[name="date"]',
      'meta[itemprop="datePublished"]',
    ]) ||
    (typeof ld?.datePublished === 'string' ? ld.datePublished : '') ||
    doc.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() ||
    '';
  const publisher = ld?.publisher && typeof ld.publisher === 'object' ? String((ld.publisher as Record<string, unknown>).name ?? '') : '';
  const site = metaContent(doc, ['meta[name="citation_journal_title"]', 'meta[property="og:site_name"]', 'meta[name="application-name"]']) || publisher.trim();
  return { title: title.replace(/\s+/g, ' '), authors: [...new Set(authors)], published, site };
}

/** Split "Jane Q. Smith" into first and last. Multiple authors become "Smith et al." style input for the user to refine. */
export function splitName(full: string): { first: string; last: string } {
  const name = full.replace(/\s+/g, ' ').replace(/^by\s+/i, '').trim();
  if (!name) return { first: '', last: '' };
  if (name.includes(',')) {
    const [last, first = ''] = name.split(',', 2).map((s) => s.trim());
    return { first, last };
  }
  const bits = name.split(' ');
  if (bits.length === 1) return { first: '', last: bits[0] };
  return { first: bits.slice(0, -1).join(' '), last: bits[bits.length - 1] };
}

/** Fill a cite from a page's own metadata. Only empty fields are filled; nothing you typed is overwritten. */
export function citeFromMeta(base: Cite, meta: PageMeta, url: string, nowMs = Date.now()): Cite {
  const out = { ...base };
  const set = (field: keyof Cite, value: string) => {
    if (!out[field].trim() && value.trim()) out[field] = value.trim();
  };
  if (meta.authors.length) {
    const { first, last } = splitName(meta.authors[0]);
    set('first', first);
    set('last', meta.authors.length > 2 ? `${last} et al.` : meta.authors.length === 2 ? `${last} and ${splitName(meta.authors[1]).last}` : last);
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta.published);
  if (d) {
    set('year', d[1]);
    set('date', `${Number(d[2])}/${Number(d[3])}`);
  } else {
    const y = /\b(19|20)\d{2}\b/.exec(meta.published);
    if (y) set('year', y[0]);
  }
  set('title', meta.title);
  set('publication', meta.site);
  set('url', url);
  set('accessed', todayForCite(nowMs));
  return out;
}
