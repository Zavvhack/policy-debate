// Writing .docx files that Word, Google Docs and Verbatim all open correctly.
//
// Card format (see the README's "Card format" section):
//   Tag   - Heading 4, bold, 13pt Calibri; key phrases may be underlined
//   Cite  - last name and the last two digits of the year bold 13pt, the rest 11pt, ends with //initials
//   Body  - unread text small (7pt by default)
//           underlined-but-not-read text 11pt underlined
//           read text 11pt underlined + highlighted
//           emphasis 11pt bold + underlined + highlighted
//
// Verbatim compatibility: headings use Word's built-in Heading 1-4 (Verbatim's
// Pocket / Hat / Block / Tag), and runs carry the character styles Verbatim
// uses for cites, underlining and emphasis. Every run ALSO has the formatting
// applied directly, so the file looks right in programs that ignore styles.

import JSZip from 'jszip';
import type { Cite, Mark, Settings, TagPart, WordHighlight } from '../../data/schema';
import type { Side } from '../debate/formats';
import { formatCite, type CitePart } from '../cards/cite';
import { toParagraphs } from '../cards/text';
import { escapeXml } from './xml';

/** The parts of a card the exporters need. A saved Card fits this shape. */
export interface ExportCard {
  tag: TagPart[];
  cite: Cite;
  citeRaw?: CitePart[];
  text: string;
  marks: Mark[];
}

export type DocItem =
  /** Level 1 = Pocket, 2 = Hat, 3 = Block. */
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'card'; card: ExportCard; side: Side }
  /** Your own words. Line breaks start new paragraphs. */
  | { kind: 'text'; text: string; bold?: boolean };

export type HighlightStyle = Settings['highlight'];

export const WORD_HIGHLIGHT_HEX: Record<WordHighlight, string> = {
  yellow: 'FFFF00',
  green: '00FF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  red: 'FF0000',
  blue: '0000FF',
  lightGray: 'C0C0C0',
  darkYellow: '808000',
};

export const WORD_HIGHLIGHT_LABEL: Record<WordHighlight, string> = {
  yellow: 'Yellow',
  green: 'Bright green',
  cyan: 'Turquoise / cyan (light blue)',
  magenta: 'Pink / magenta',
  red: 'Red',
  blue: 'Blue (too dark to read through)',
  lightGray: 'Light gray',
  darkYellow: 'Dark yellow',
};

/** The colour used on screen and in copied text for a side's highlighting. */
export function highlightHex(style: HighlightStyle, side: Side): string {
  if (style.mode === 'word') return `#${WORD_HIGHLIGHT_HEX[side === 'neg' ? style.negWord : style.affWord]}`;
  const c = side === 'neg' ? style.negColor : style.affColor;
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : side === 'neg' ? '#ff9e9e' : '#8fd3ff';
}

interface RunFormat {
  bold?: boolean;
  underline?: boolean;
  /** Font size in half-points (22 = 11pt). */
  size?: number;
  highlight?: boolean;
  /** A Verbatim character style id. */
  style?: 'Style13ptBold' | 'StyleUnderline' | 'Emphasis';
}

function highlightXml(style: HighlightStyle, side: Side): string {
  if (style.mode === 'word') return `<w:highlight w:val="${side === 'neg' ? style.negWord : style.affWord}"/>`;
  // Custom colours are not in Word's highlighter palette, so they are written as shading.
  return `<w:shd w:val="clear" w:color="auto" w:fill="${highlightHex(style, side).slice(1).toUpperCase()}"/>`;
}

function run(text: string, f: RunFormat, hl: string): string {
  if (!text) return '';
  // The order of elements inside w:rPr is fixed by the file format:
  // rStyle, rFonts, b, sz, highlight, u, shd.
  let pr = '';
  if (f.style) pr += `<w:rStyle w:val="${f.style}"/>`;
  pr += '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>';
  if (f.bold) pr += '<w:b/><w:bCs/>';
  if (f.size) pr += `<w:sz w:val="${f.size}"/><w:szCs w:val="${f.size}"/>`;
  const isShade = hl.startsWith('<w:shd');
  if (f.highlight && !isShade) pr += hl;
  if (f.underline) pr += '<w:u w:val="single"/>';
  if (f.highlight && isShade) pr += hl;
  // Tabs must be their own element; everything else is plain text.
  const body = text
    .split('\t')
    .map((piece) => (piece ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>` : ''))
    .join('<w:tab/>');
  return `<w:r><w:rPr>${pr}</w:rPr>${body}</w:r>`;
}

function paragraph(runs: string, style?: string): string {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`;
}

function cardXml(card: ExportCard, side: Side, style: HighlightStyle): string {
  const hl = highlightXml(style, side);
  const unread = Math.round(Math.min(11, Math.max(4, style.unreadPt)) * 2);
  let out = paragraph(card.tag.map((p) => run(p.t, { bold: true, underline: !!p.u, size: 26 }, hl)).join(''), 'Heading4');
  const cite = card.citeRaw?.length ? card.citeRaw : formatCite(card.cite);
  if (cite.length) {
    out += paragraph(cite.map((p) => (p.big ? run(p.t, { bold: true, size: 26, style: 'Style13ptBold' }, hl) : run(p.t, { size: 22 }, hl))).join(''));
  }
  for (const para of toParagraphs(card.text, card.marks)) {
    out += paragraph(
      para.runs
        .map((r) => {
          if (r.lv === 0) return run(r.t, { size: unread }, hl);
          if (r.lv === 1) return run(r.t, { underline: true, size: 22, style: 'StyleUnderline' }, hl);
          if (r.lv === 2) return run(r.t, { underline: true, size: 22, highlight: true, style: 'StyleUnderline' }, hl);
          return run(r.t, { bold: true, underline: true, size: 22, highlight: true, style: 'Emphasis' }, hl);
        })
        .join(''),
    );
  }
  return out + '<w:p/>';
}

/** The main document part. Exported so tests can check it without unzipping. */
export function documentXml(items: readonly DocItem[], style: HighlightStyle): string {
  let body = '';
  for (const item of items) {
    if (item.kind === 'heading') body += paragraph(run(item.text, {}, ''), `Heading${item.level}`);
    else if (item.kind === 'card') body += cardXml(item.card, item.side, style);
    else {
      for (const line of item.text.split(/\r?\n/)) {
        // The "Analytic" style marks these as your own words, so that re-importing
        // the file never mistakes them for part of the card above.
        body += line.trim() ? paragraph(run(line, { size: 22, bold: item.bold }, ''), 'Analytic') : '<w:p/>';
      }
    }
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function headingStyle(level: number, alias: string, size: number, extra: string, jc: string): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:aliases w:val="${alias}"/>` +
    `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="${level === 4 ? 3 : level - 1}"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/>${jc}<w:spacing w:before="${level === 4 ? 40 : 240}" w:after="0"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${extra}</w:rPr></w:style>`
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles ${W}>` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
  headingStyle(1, 'Pocket', 52, '', '<w:jc w:val="center"/>') +
  headingStyle(2, 'Hat', 44, '<w:u w:val="double"/>', '<w:jc w:val="center"/>') +
  headingStyle(3, 'Block', 32, '<w:u w:val="single"/>', '<w:jc w:val="center"/>') +
  headingStyle(4, 'Tag', 26, '', '') +
  '<w:style w:type="paragraph" w:styleId="Analytic"><w:name w:val="Analytic"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="4"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:styleId="Style13ptBold"><w:name w:val="Style 13 pt Bold"/><w:aliases w:val="Cite"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="5"/><w:qFormat/><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="StyleUnderline"><w:name w:val="Style Underline"/><w:aliases w:val="Underline"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="6"/><w:qFormat/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/><w:u w:val="single"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="7"/><w:qFormat/><w:rPr><w:b/><w:bCs/><w:i w:val="0"/><w:iCs w:val="0"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:u w:val="single"/></w:rPr></w:style>' +
  '</w:styles>';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Build a complete .docx file. */
export async function buildDocx(items: readonly DocItem[], style: HighlightStyle): Promise<Uint8Array> {
  const zip = new JSZip();
  // [Content_Types].xml must be the first entry for some readers.
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/document.xml', documentXml(items, style));
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
