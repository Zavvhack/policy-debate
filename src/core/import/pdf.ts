// Reading the text out of a PDF.
//
// A PDF stores positioned fragments of text, not paragraphs, so the text has to
// be rebuilt from where things sit on the page. That works well for ordinary
// articles and badly for scans (which contain no text at all) and for
// multi-column layouts. The app always tells the user to compare the result
// with the original before cutting.

export interface PdfTextItem {
  str: string;
  /** True if this fragment ends a line. */
  hasEOL: boolean;
  /** Vertical position on the page (bigger = higher up). */
  y: number;
  /** Text height. */
  height: number;
}

/**
 * Rebuild paragraphs from one page's text fragments.
 *  - fragments on the same line are joined;
 *  - a word split across lines with a hyphen ("insur-" / "ance") is joined back;
 *  - a vertical gap clearly bigger than the line spacing starts a new paragraph.
 */
export function rebuildPageText(items: readonly PdfTextItem[]): string {
  const lines: { text: string; y: number; height: number }[] = [];
  let cur = '';
  let y = 0;
  let h = 0;
  for (const it of items) {
    if (!cur) {
      y = it.y;
      h = it.height;
    }
    cur += it.str;
    h = Math.max(h, it.height);
    if (it.hasEOL) {
      lines.push({ text: cur, y, height: h });
      cur = '';
    }
  }
  if (cur) lines.push({ text: cur, y, height: h });

  // The usual distance between lines, to tell a paragraph gap from a line gap.
  // The lower quartile is used (not the average) so a short page with several
  // paragraph breaks does not mistake those breaks for normal spacing.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const usual = gaps.length ? gaps[Math.floor(gaps.length * 0.25)] : 0;

  let out = '';
  let prev: { y: number; height: number } | null = null;
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!prev) {
      out = text;
      prev = line;
      continue;
    }
    const gap = prev.y - line.y;
    // A new paragraph: the gap is clearly bigger than both the usual line spacing
    // and the text itself is tall, or the text jumps back up the page (a new column).
    const textHeight = Math.min(prev.height || line.height, line.height || prev.height);
    const threshold = Math.max(usual * 1.45, textHeight * 1.75);
    const newParagraph = threshold > 0 && (gap > threshold || gap < -Math.max(usual, textHeight));
    if (newParagraph) out += `\n\n${text}`;
    else if (/[\p{L}]-$/u.test(out) && /^[\p{Ll}]/u.test(text)) out = out.slice(0, -1) + text; // re-join a hyphenated word
    else out += ` ${text}`;
    prev = line;
  }
  return out;
}

export interface PdfText {
  text: string;
  pages: number;
  title: string;
  author: string;
}

/** Extract the text of a PDF. Throws a readable error for encrypted or image-only files. */
export async function readPdf(data: Uint8Array): Promise<PdfText> {
  // Loaded on demand: the PDF engine is large and most sessions never need it.
  const pdfjs = await import('pdfjs-dist');
  // Run the engine on the main thread. A real worker needs a separate file,
  // which the single-file version of the app cannot have.
  const g = globalThis as unknown as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');

  // The loading task owns the engine; destroying it afterwards frees the memory.
  const task = pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (name === 'PasswordException') throw new Error('This PDF is password-protected, so its text cannot be read.');
    throw new Error('This file could not be read as a PDF.');
  }
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const raw of content.items as unknown[]) {
      const it = raw as { str?: string; hasEOL?: boolean; transform?: number[]; height?: number };
      if (typeof it.str !== 'string') continue;
      items.push({ str: it.str, hasEOL: !!it.hasEOL, y: it.transform?.[5] ?? 0, height: it.height ?? 0 });
    }
    const text = rebuildPageText(items);
    if (text) pages.push(text);
    page.cleanup();
  }
  let title = '';
  let author = '';
  try {
    const info = ((await doc.getMetadata()).info ?? {}) as { Title?: string; Author?: string };
    title = (info.Title ?? '').trim();
    author = (info.Author ?? '').trim();
  } catch {
    /* metadata is optional */
  }
  const numPages = doc.numPages;
  await task.destroy();
  const text = pages.join('\n\n');
  if (text.replace(/\s/g, '').length < 20) {
    throw new Error('No text was found in this PDF. It is probably a scan (pictures of pages). Run it through OCR first, or paste the text by hand.');
  }
  return { text, pages: numPages, title, author };
}
