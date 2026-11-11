// One way in for every kind of source: pasted text, a file, or a URL.

import { citeFromMeta, splitName, type PageMeta } from '../cards/cite';
import type { Cite, SourceDoc } from '../../data/schema';
import { docxToText, readDocx } from '../docx/read';
import { extractArticle } from './html';
import { readPdf } from './pdf';

export interface ImportedSource {
  kind: SourceDoc['kind'];
  name: string;
  url: string;
  text: string;
  /** Citation details the source published about itself. */
  meta: string;
  /** Cite fields that could be filled in without AI. */
  suggest: Partial<Cite>;
  /** Something the user should know before cutting (e.g. "PDF text was rebuilt"). */
  note: string;
}

const PDF_NOTE =
  'This text was rebuilt from the PDF\'s page layout. Check it against the original before cutting: line breaks, hyphenated words, footnotes and page headers can end up in the wrong place.';

function fromMeta(meta: PageMeta, url: string): Partial<Cite> {
  const blank: Cite = { first: '', last: '', year: '', date: '', quals: '', title: '', publication: '', url: '', accessed: '', pages: '', initials: '' };
  const filled = citeFromMeta(blank, meta, url);
  return Object.fromEntries(Object.entries(filled).filter(([, v]) => v)) as Partial<Cite>;
}

export function importHtml(html: string, url: string, name = ''): ImportedSource {
  const page = extractArticle(html);
  if (page.text.trim().length < 80) throw new Error('No article text was found on that page. Try pasting the text instead.');
  return { kind: 'url', name: page.title || name || url, url, text: page.text, meta: page.metaText, suggest: fromMeta(page.meta, url), note: '' };
}

export async function importPdfBytes(bytes: Uint8Array, name: string, url = ''): Promise<ImportedSource> {
  const pdf = await readPdf(bytes);
  const suggest: Partial<Cite> = {};
  if (pdf.title) suggest.title = pdf.title;
  if (pdf.author) {
    const n = splitName(pdf.author.split(/[;,]| and /)[0]);
    if (n.first) suggest.first = n.first;
    if (n.last) suggest.last = n.last;
  }
  if (url) suggest.url = url;
  return {
    kind: 'pdf',
    name: pdf.title || name,
    url,
    text: pdf.text,
    meta: [pdf.title, pdf.author].filter(Boolean).join('\n'),
    suggest,
    note: `${PDF_NOTE} (${pdf.pages} page${pdf.pages === 1 ? '' : 's'}.)`,
  };
}

/** Read a file the user picked: PDF, Word (.docx), saved web page (.html), or plain text. */
export async function importFile(file: File): Promise<ImportedSource> {
  const name = file.name;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const looksPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"
  const looksZip = bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": .docx files are zips
  if (looksPdf || ext === 'pdf') return importPdfBytes(bytes, name.replace(/\.pdf$/i, ''));
  if (ext === 'docx' || (looksZip && ext !== 'zip')) {
    const text = docxToText(await readDocx(bytes));
    if (!text.trim()) throw new Error('That Word document has no text in it.');
    return { kind: 'docx', name: name.replace(/\.docx$/i, ''), url: '', text, meta: '', suggest: {}, note: '' };
  }
  if (ext === 'doc') throw new Error('Old .doc files cannot be read. Open it in Word or Google Docs and save it as .docx.');
  const text = new TextDecoder('utf-8').decode(bytes);
  if (ext === 'html' || ext === 'htm' || /^\s*<(!doctype|html)/i.test(text)) return { ...importHtml(text, '', name.replace(/\.html?$/i, '')), kind: 'url' };
  if (/\u0000/.test(text.slice(0, 2000))) throw new Error('That file type is not supported. Use a PDF, a .docx, a saved web page (.html), or a text file.');
  return { kind: 'paste', name: name.replace(/\.[a-z0-9]+$/i, ''), url: '', text, meta: '', suggest: {}, note: '' };
}

/** Turn what the desktop app fetched from a URL into a source. */
export async function importFetched(page: { url: string; status: number; contentType: string; bytes: Uint8Array }): Promise<ImportedSource> {
  if (page.status >= 400) {
    const why = page.status === 401 || page.status === 403 ? 'the site refused (it may need a login or block automated requests)' : page.status === 404 ? 'the page was not found' : `the site answered with error ${page.status}`;
    throw new Error(`Could not fetch that page: ${why}. Open it in your browser and paste the text instead.`);
  }
  const isPdf = /pdf/i.test(page.contentType) || (page.bytes[0] === 0x25 && page.bytes[1] === 0x50 && page.bytes[2] === 0x44 && page.bytes[3] === 0x46);
  if (isPdf) return importPdfBytes(page.bytes, decodeURIComponent(page.url.split('/').pop()?.replace(/\.pdf.*$/i, '') || 'PDF'), page.url);
  const charset = /charset=([\w-]+)/i.exec(page.contentType)?.[1] ?? 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charset).decode(page.bytes);
  } catch {
    html = new TextDecoder('utf-8').decode(page.bytes);
  }
  return importHtml(html, page.url);
}
