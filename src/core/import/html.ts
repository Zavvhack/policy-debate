// Turning a web page into plain article text (no AI involved).
//
// The page is parsed into an inert document (scripts never run, images never
// load) and Mozilla's Readability, the engine behind Firefox's Reader View,
// picks out the article. We then keep only the text.

import { Readability } from '@mozilla/readability';
import { extractPageMeta, type PageMeta } from '../cards/cite';

const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'FIGCAPTION', 'SECTION', 'ARTICLE', 'DD', 'DT', 'TABLE', 'UL', 'OL']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'BUTTON', 'FORM', 'NAV']);

/** The text of an element, with a blank line between paragraphs. */
export function htmlToText(root: Element): string {
  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    const t = current.replace(/[ \t\r\n ]+/g, ' ').trim();
    if (t) paragraphs.push(t);
    current = '';
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      current += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (tag === 'BR') {
      current += ' ';
      return;
    }
    const block = BLOCKS.has(tag);
    if (block) flush();
    el.childNodes.forEach(walk);
    if (block) flush();
  };
  walk(root);
  return paragraphs.join('\n\n');
}

export interface ExtractedPage {
  title: string;
  text: string;
  meta: PageMeta;
  /** A short "what the page says about itself" block, used when checking cites. */
  metaText: string;
}

export function extractArticle(html: string): ExtractedPage {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = extractPageMeta(doc);
  let text = '';
  let byline = '';
  try {
    // Readability changes the document it is given, so hand it a copy.
    const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 200 }).parse();
    if (article?.content) {
      const body = new DOMParser().parseFromString(article.content, 'text/html').body;
      text = htmlToText(body);
      byline = (article.byline ?? '').replace(/\s+/g, ' ').trim();
      if (!meta.title && article.title) meta.title = article.title.trim();
      if (!meta.site && article.siteName) meta.site = article.siteName.trim();
      if (!meta.published && article.publishedTime) meta.published = article.publishedTime.trim();
    }
  } catch (err) {
    console.warn('Reader extraction failed; using the whole page text.', err);
  }
  // Fall back to everything on the page if no article was found.
  if (text.length < 200 && doc.body) text = htmlToText(doc.body);
  if (byline && !meta.authors.length) meta.authors = [byline.replace(/^by\s+/i, '')];
  const metaText = [meta.title, meta.authors.join(', '), byline, meta.published, meta.site].filter(Boolean).join('\n');
  return { title: meta.title, text, meta, metaText };
}
