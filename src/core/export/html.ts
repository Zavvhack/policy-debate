// Rich text for the clipboard: paste into Google Docs or Word and the card
// keeps its formatting (heading-4 tag, bold cite, small / underlined /
// highlighted / emphasised body).
//
// Everything is built from escaped text, never from stored HTML, so nothing
// pasted into a card can turn into live markup.

import type { Side } from '../debate/formats';
import { formatCite, citeToText } from '../cards/cite';
import { tagText, toParagraphs } from '../cards/text';
import { highlightHex, type DocItem, type ExportCard, type HighlightStyle } from '../docx/write';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const FONT = 'font-family:Calibri,Carlito,Arial,sans-serif;';

export function cardToHtml(card: ExportCard, side: Side, style: HighlightStyle): string {
  const hl = highlightHex(style, side);
  const unread = Math.min(11, Math.max(4, style.unreadPt));
  const tag = card.tag.map((p) => (p.u ? `<u>${escapeHtml(p.t)}</u>` : escapeHtml(p.t))).join('');
  const citeParts = card.citeRaw?.length ? card.citeRaw : formatCite(card.cite);
  const cite = citeParts.map((p) => (p.big ? `<b style="font-size:13pt">${escapeHtml(p.t)}</b>` : escapeHtml(p.t))).join('');
  const css: Record<number, string> = {
    0: `font-size:${unread}pt;`,
    1: 'font-size:11pt;text-decoration:underline;',
    2: `font-size:11pt;text-decoration:underline;background-color:${hl};`,
    3: `font-size:11pt;text-decoration:underline;font-weight:bold;background-color:${hl};`,
  };
  const body = toParagraphs(card.text, card.marks)
    .map((p) => `<p style="${FONT}margin:0 0 8pt">${p.runs.map((r) => `<span style="${css[r.lv]}">${escapeHtml(r.t)}</span>`).join('')}</p>`)
    .join('');
  return (
    `<h4 style="${FONT}font-size:13pt;font-weight:bold;margin:0">${tag}</h4>` +
    (cite ? `<p style="${FONT}font-size:11pt;margin:0 0 8pt">${cite}</p>` : '') +
    body
  );
}

export function cardToPlainText(card: ExportCard): string {
  const cite = card.citeRaw?.length ? card.citeRaw.map((p) => p.t).join('') : citeToText(card.cite);
  const body = toParagraphs(card.text, card.marks)
    .map((p) => p.runs.map((r) => r.t).join(''))
    .join('\n');
  return [tagText(card.tag), cite, body].filter(Boolean).join('\n') + '\n';
}

const HEADING_SIZE = { 1: 26, 2: 22, 3: 16 } as const;

/** A whole document (headings, cards, your own text) as HTML for the clipboard. */
export function itemsToHtml(items: readonly DocItem[], style: HighlightStyle): string {
  return items
    .map((item) => {
      if (item.kind === 'heading') {
        return `<h${item.level} style="${FONT}font-size:${HEADING_SIZE[item.level]}pt;font-weight:bold;text-align:center;margin:12pt 0 4pt">${escapeHtml(item.text)}</h${item.level}>`;
      }
      if (item.kind === 'card') return cardToHtml(item.card, item.side, style) + `<p style="${FONT}margin:0"><br></p>`;
      return item.text
        .split(/\r?\n/)
        .map((line) => `<p style="${FONT}font-size:11pt;margin:0 0 6pt${item.bold ? ';font-weight:bold' : ''}">${escapeHtml(line) || '<br>'}</p>`)
        .join('');
    })
    .join('');
}

export function itemsToPlainText(items: readonly DocItem[]): string {
  return items
    .map((item) => (item.kind === 'heading' ? `\n${item.text.toUpperCase()}\n` : item.kind === 'card' ? cardToPlainText(item.card) : `${item.text}\n`))
    .join('\n')
    .trim();
}

/**
 * Put rich text on the clipboard. Tries the modern clipboard API first, then
 * falls back to copying a hidden, rendered copy (which works in more places,
 * including some desktop web views). Returns false if both are blocked.
 */
export async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through to the older method
  }
  try {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;color:#000';
    // Safe: `html` is produced above from escaped text only.
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    holder.remove();
    return ok;
  } catch {
    return false;
  }
}
