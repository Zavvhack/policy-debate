// Reading .docx files.
//
// Two uses:
//   1. Importing evidence files (Verbatim format, e.g. from openCaselist):
//      headings become the file's outline, each Tag (Heading 4) starts a card.
//   2. Importing an article saved as a Word document: just its text.
//
// Imported cards have no source article on file, so the app labels them
// "imported - not checked against a source". Their text is taken exactly as it
// is in the file; nothing is corrected or reflowed.

import JSZip from 'jszip';
import type { Mark, TagPart } from '../../data/schema';
import type { CitePart } from '../cards/cite';
import { levelsToMarks, tidyLevels } from '../cards/text';
import { child, descendants, parseXml, type XNode } from './xml';

export interface DocRun {
  t: string;
  bold: boolean;
  underline: boolean;
  /** True if highlighted or shaded with a colour. */
  highlight: boolean;
  /** Font size in half-points, if known. */
  size: number | null;
  /** Character style id, e.g. "Emphasis". */
  style: string;
}

export interface DocParagraph {
  /** 1-4 for Pocket / Hat / Block / Tag; 0 for ordinary text. */
  heading: 0 | 1 | 2 | 3 | 4;
  /** True for paragraphs in an "Analytic" style: someone's own words, never part of a card. */
  analytic: boolean;
  runs: DocRun[];
}

interface StyleInfo {
  basedOn: string;
  name: string;
  outline: number | null;
  bold: boolean | null;
  underline: boolean | null;
  highlight: boolean | null;
  size: number | null;
}

/** Is an on/off property like <w:b/> switched on? (<w:b w:val="0"/> means off.) */
function onOff(node: XNode | undefined): boolean | null {
  if (!node) return null;
  const v = node.attrs['w:val'];
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}

function runProps(rPr: XNode | undefined): Pick<StyleInfo, 'bold' | 'underline' | 'highlight' | 'size'> {
  const u = child(rPr, 'w:u');
  const hl = child(rPr, 'w:highlight');
  const shd = child(rPr, 'w:shd');
  const sz = child(rPr, 'w:sz');
  const fill = shd?.attrs['w:fill']?.toLowerCase();
  let highlight: boolean | null = null;
  if (hl) highlight = hl.attrs['w:val'] !== 'none';
  // Shading counts as highlighting unless it is "no colour" or white.
  else if (shd && fill) highlight = fill !== 'auto' && fill !== 'ffffff';
  return {
    bold: onOff(child(rPr, 'w:b')),
    underline: u ? (u.attrs['w:val'] ?? 'single') !== 'none' : null,
    highlight,
    size: sz && /^\d+$/.test(sz.attrs['w:val'] ?? '') ? Number(sz.attrs['w:val']) : null,
  };
}

function readStyles(xml: string | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  for (const s of descendants(parseXml(xml), 'w:style')) {
    const id = s.attrs['w:styleId'];
    if (!id) continue;
    const lvl = child(child(s, 'w:pPr'), 'w:outlineLvl')?.attrs['w:val'];
    styles.set(id, {
      basedOn: child(s, 'w:basedOn')?.attrs['w:val'] ?? '',
      name: (child(s, 'w:name')?.attrs['w:val'] ?? '').toLowerCase(),
      outline: lvl !== undefined && /^\d$/.test(lvl) ? Number(lvl) : null,
      ...runProps(child(s, 'w:rPr')),
    });
  }
  return styles;
}

/** A style's formatting, following "based on" links (with a guard against loops). */
function resolveStyle(styles: Map<string, StyleInfo>, id: string): StyleInfo | null {
  let cur = styles.get(id);
  if (!cur) return null;
  const merged: StyleInfo = { ...cur };
  const seen = new Set([id]);
  while (cur.basedOn && !seen.has(cur.basedOn)) {
    seen.add(cur.basedOn);
    const parent = styles.get(cur.basedOn);
    if (!parent) break;
    merged.bold ??= parent.bold;
    merged.underline ??= parent.underline;
    merged.highlight ??= parent.highlight;
    merged.size ??= parent.size;
    merged.outline ??= parent.outline;
    cur = parent;
  }
  return merged;
}

function headingLevel(styles: Map<string, StyleInfo>, styleId: string, pPr: XNode | undefined): DocParagraph['heading'] {
  const direct = child(pPr, 'w:outlineLvl')?.attrs['w:val'];
  const style = styleId ? resolveStyle(styles, styleId) : null;
  let level: number | null = direct !== undefined && /^\d$/.test(direct) ? Number(direct) + 1 : null;
  if (level === null && style?.outline !== null && style?.outline !== undefined) level = style.outline + 1;
  if (level === null) {
    // Fall back to the style's name: "heading 3", "Heading3", or Verbatim's own names.
    const name = `${styleId} ${style?.name ?? ''}`.toLowerCase();
    const m = /heading\s*([1-4])/.exec(name);
    if (m) level = Number(m[1]);
    else if (/\bpocket\b/.test(name)) level = 1;
    else if (/\bhat\b/.test(name)) level = 2;
    else if (/\bblock\b/.test(name)) level = 3;
    else if (/\btag\b/.test(name)) level = 4;
  }
  return level !== null && level >= 1 && level <= 4 ? (level as DocParagraph['heading']) : 0;
}

/** Collect the runs of a paragraph, looking inside links and other wrappers but skipping deleted text. */
function collectRuns(node: XNode, styles: Map<string, StyleInfo>, paraStyle: StyleInfo | null, out: DocRun[]): void {
  for (const c of node.children) {
    if (c.name === 'w:del' || c.name === 'w:moveFrom' || c.name === 'w:pPr' || c.name === 'mc:Fallback') continue;
    if (c.name !== 'w:r') {
      collectRuns(c, styles, paraStyle, out);
      continue;
    }
    const rPr = child(c, 'w:rPr');
    const styleId = child(rPr, 'w:rStyle')?.attrs['w:val'] ?? '';
    const charStyle = styleId ? resolveStyle(styles, styleId) : null;
    const direct = runProps(rPr);
    // Direct formatting wins, then the character style, then the paragraph style.
    const pick = <K extends 'bold' | 'underline' | 'highlight' | 'size'>(k: K) => direct[k] ?? charStyle?.[k] ?? paraStyle?.[k] ?? null;
    let text = '';
    for (const part of c.children) {
      if (part.name === 'w:t') text += part.children.map((x) => x.text).join('');
      else if (part.name === 'w:tab') text += '\t';
      else if (part.name === 'w:br' || part.name === 'w:cr') text += ' ';
      else if (part.name === 'w:noBreakHyphen') text += '-';
    }
    if (!text) continue;
    out.push({ t: text, bold: pick('bold') === true, underline: pick('underline') === true, highlight: pick('highlight') === true, size: pick('size'), style: styleId });
  }
}

/** Read every paragraph of a .docx file, in order (including those inside tables). */
export async function readDocx(data: ArrayBuffer | Uint8Array): Promise<DocParagraph[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('This file is not a .docx document (it could not be opened as one).');
  }
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('This file is not a Word document (it has no document part). Old .doc files must be saved as .docx first.');
  const styles = readStyles((await zip.file('word/styles.xml')?.async('string')) ?? null);
  const root = parseXml(await documentFile.async('string'));
  const paragraphs: DocParagraph[] = [];
  for (const p of descendants(root, 'w:p')) {
    const pPr = child(p, 'w:pPr');
    const styleId = child(pPr, 'w:pStyle')?.attrs['w:val'] ?? '';
    const runs: DocRun[] = [];
    collectRuns(p, styles, styleId ? resolveStyle(styles, styleId) : null, runs);
    const analytic = /analytic/i.test(`${styleId} ${styles.get(styleId)?.name ?? ''}`);
    paragraphs.push({ heading: headingLevel(styles, styleId, pPr), analytic, runs });
  }
  return paragraphs;
}

export function paragraphText(p: DocParagraph): string {
  return p.runs.map((r) => r.t).join('');
}

/** The document as plain text: one line per paragraph, blank line between them. For importing an article. */
export function docxToText(paragraphs: readonly DocParagraph[]): string {
  return paragraphs
    .map(paragraphText)
    .filter((t) => t.trim())
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Evidence files
// ---------------------------------------------------------------------------

export interface ImportedCard {
  tag: TagPart[];
  citeRaw: CitePart[];
  /** Best guess at the author's last name and year, for sorting and "Smith 26". Empty if unsure. */
  last: string;
  year: string;
  text: string;
  marks: Mark[];
  /** The Pocket / Hat / Block headings the card sat under. */
  path: string[];
}

export type OutlineItem =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'card'; index: number }
  /** A tag with no evidence under it, or loose text: your own (or their own) words. */
  | { kind: 'text'; text: string };

export interface ImportedFile {
  cards: ImportedCard[];
  outline: OutlineItem[];
}

const YEAR = /\b((?:19|20)\d{2})\b/;

/** Does this paragraph look like a citation line? */
function looksLikeCite(p: DocParagraph): boolean {
  const text = paragraphText(p);
  if (!text.trim() || text.length > 1500) return false;
  if (p.runs.some((r) => /13ptbold|cite/i.test(r.style))) return true;
  const hasBold = p.runs.some((r) => r.bold && r.t.trim());
  return (hasBold || /https?:\/\//i.test(text)) && (YEAR.test(text) || /\b['’]?\d{2}\b/.test(text));
}

function guessAuthorYear(p: DocParagraph): { last: string; year: string } {
  const text = paragraphText(p).trim();
  // "Smith 26", "Smith, 2026", "Smith and Jones 24", "Smith et al. 2025"
  const m = /^([\p{Lu}][\p{L}'’-]+(?:\s+(?:and|&)\s+[\p{Lu}][\p{L}'’-]+|\s+et\s+al\.?)?),?\s+['’]?(\d{4}|\d{2})\b/u.exec(text);
  if (m) return { last: m[1], year: m[2].length === 2 ? `20${m[2]}` : m[2] };
  const y = YEAR.exec(text);
  return { last: '', year: y ? y[1] : '' };
}

function runLevel(r: DocRun): 0 | 1 | 2 | 3 {
  const emphasis = /emphasis/i.test(r.style) || (r.bold && r.underline);
  if (r.highlight) return emphasis ? 3 : 2;
  return r.underline || emphasis ? 1 : 0;
}

/**
 * Turn a Verbatim-style document into cards and an outline.
 * A card = a Tag (Heading 4), then a cite line, then body paragraphs up to the next heading.
 */
export function extractCards(paragraphs: readonly DocParagraph[]): ImportedFile {
  const cards: ImportedCard[] = [];
  const outline: OutlineItem[] = [];
  const path: string[] = ['', '', ''];
  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];
    const text = paragraphText(p).trim();
    if (!text) {
      i++;
      continue;
    }
    if (p.heading >= 1 && p.heading <= 3) {
      path[p.heading - 1] = text;
      for (let k = p.heading; k < 3; k++) path[k] = '';
      outline.push({ kind: 'heading', level: p.heading as 1 | 2 | 3, text });
      i++;
      continue;
    }
    if (p.heading === 0) {
      // Loose text, or an analytic: join consecutive lines into one item.
      const prev = outline[outline.length - 1];
      if (prev?.kind === 'text' && paragraphs[i - 1] && paragraphText(paragraphs[i - 1]).trim() && paragraphs[i - 1].heading === 0) prev.text += `\n${text}`;
      else outline.push({ kind: 'text', text });
      i++;
      continue;
    }
    // A tag. Gather what follows until the next heading.
    const tag: TagPart[] = p.runs.filter((r) => r.t).map((r) => (r.underline ? { t: r.t, u: true } : { t: r.t }));
    let j = i + 1;
    const following: DocParagraph[] = [];
    while (j < paragraphs.length && paragraphs[j].heading === 0 && !paragraphs[j].analytic) {
      if (paragraphText(paragraphs[j]).trim()) following.push(paragraphs[j]);
      j++;
    }
    i = j;
    const cite = following.length && looksLikeCite(following[0]) ? following[0] : null;
    const body = cite ? following.slice(1) : following;
    if (!cite || !body.length) {
      // No evidence under this tag: it is an analytic. Keep its words.
      outline.push({ kind: 'text', text: [text, ...following.map((f) => paragraphText(f).trim())].join('\n') });
      continue;
    }
    // Build the body text and per-character levels, exactly as written.
    let bodyText = '';
    const levels: number[] = [];
    body.forEach((bp, n) => {
      if (n > 0) {
        bodyText += '\n';
        levels.push(0);
      }
      for (const r of bp.runs) {
        const lv = runLevel(r);
        bodyText += r.t;
        for (let k = 0; k < r.t.length; k++) levels.push(lv);
      }
    });
    const guess = guessAuthorYear(cite);
    cards.push({
      tag,
      citeRaw: cite.runs.filter((r) => r.t).map((r) => (r.bold || /13ptbold|cite/i.test(r.style) ? { t: r.t, big: true } : { t: r.t })),
      last: guess.last,
      year: guess.year,
      text: bodyText,
      marks: levelsToMarks(tidyLevels(bodyText, Uint8Array.from(levels))),
      path: path.filter(Boolean),
    });
    outline.push({ kind: 'card', index: cards.length - 1 });
  }
  return { cards, outline };
}
