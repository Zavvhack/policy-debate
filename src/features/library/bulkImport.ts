// "Import many files": bring a whole folder, or a .zip, of evidence files into
// the library in one go.
//
// Files named the way camp libraries are usually split,
//   "Econ DA - Neg - DDI 2026 BMW.docx"
// get their side from the name (Aff, Neg, or General = both) and the argument
// ("Econ DA") as a label. The folder a file sat in ("Disadvantages") is a
// label too, so the library can be filtered by it. Files already imported
// are skipped, so running it twice does not make duplicates.

import JSZip from 'jszip';
import { emptyCite } from '../../core/cards/cite';
import { extractCards, readDocx } from '../../core/docx/read';
import { newId, now } from '../../core/ids';
import { activeTopic, db, untouchedPackCardIds } from '../../data/store';
import type { Card, CardSide } from '../../data/schema';

/** One evidence file waiting to be read, from a picked file, a folder, or inside a .zip. */
export interface PendingFile {
  /** The file name without folders, e.g. "Econ DA - Neg - DDI 2026.docx". */
  name: string;
  /** The folder it sat in, closest last (may be empty). */
  folders: string[];
  read(): Promise<ArrayBuffer | Uint8Array>;
}

export interface LibraryName {
  /** The file name without ".docx". (`Card.pack` is this, after the folder the file was in.) */
  pack: string;
  /** "Econ DA", or the whole name if it does not follow the pattern. */
  argument: string;
  /** From " - Aff - " / " - Neg - " / " - General - " in the name; null if the name does not say. */
  side: CardSide | null;
  /** "DDI 2026 BMW", or empty. */
  camp: string;
}

const NAME_PATTERN = /^(.+?)\s+-\s+(Aff|Neg|General|Both)\s+-\s+(.+)$/i;

/** Read the side, argument and camp out of a file name like "Econ DA - Neg - DDI 2026 BMW.docx". */
export function parseLibraryName(fileName: string): LibraryName {
  const pack = fileName.replace(/\.docx$/i, '').trim();
  const m = NAME_PATTERN.exec(pack);
  if (!m) return { pack, argument: pack, side: null, camp: '' };
  const word = m[2].toLowerCase();
  const side: CardSide = word === 'aff' ? 'aff' : word === 'neg' ? 'neg' : 'both';
  return { pack, argument: m[1].trim(), side, camp: m[3].trim() };
}

/** Is this a Word file worth reading? Skips Word's "~$" lock files and the Mac's hidden "._" copies. */
function isEvidenceFile(name: string, folders: readonly string[]): boolean {
  if (!/\.docx$/i.test(name)) return false;
  if (name.startsWith('~$') || name.startsWith('._') || name.startsWith('.')) return false;
  return !folders.some((f) => f === '__MACOSX' || f.startsWith('.'));
}

function splitPath(path: string): { name: string; folders: string[] } {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return { name: parts.pop() ?? path, folders: parts };
}

/**
 * Turn what the debater picked (any mix of .docx files, .zip files, or a whole
 * folder) into a list of evidence files. Zips are opened; nothing is read yet.
 */
export async function collectFiles(picked: readonly File[]): Promise<{ files: PendingFile[]; ignored: number }> {
  const files: PendingFile[] = [];
  let ignored = 0;
  for (const file of picked) {
    // A folder pick gives each file its path inside the folder.
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const { name, folders } = splitPath(rel);
    if (/\.zip$/i.test(name)) {
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(await file.arrayBuffer());
      } catch {
        throw new Error(`"${name}" could not be opened as a .zip file. If it is still downloading, wait for it to finish and try again.`);
      }
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const inner = splitPath(entry.name);
        if (!isEvidenceFile(inner.name, inner.folders)) {
          ignored++;
          continue;
        }
        files.push({ name: inner.name, folders: inner.folders, read: () => entry.async('uint8array') });
      }
      continue;
    }
    if (!isEvidenceFile(name, folders)) {
      ignored++;
      continue;
    }
    files.push({ name, folders, read: () => file.arrayBuffer() });
  }
  // Same order every time, so the library lists them folder by folder.
  files.sort((a, b) => [...a.folders, a.name].join('/').localeCompare([...b.folders, b.name].join('/'), undefined, { numeric: true }));
  return { files, ignored };
}

/** The names (`Card.pack`) of every library file already imported for the active topic. */
export function importedPacks(): Map<string, number> {
  const topicId = activeTopic()?.id;
  const counts = new Map<string, number>();
  for (const c of db.cards.list.value) if (c.pack && c.topicId === topicId) counts.set(c.pack, (counts.get(c.pack) ?? 0) + 1);
  return counts;
}

export interface BulkProgress {
  done: number;
  total: number;
  cards: number;
  current: string;
}

export interface BulkResult {
  files: number;
  cards: number;
  /** Already in the library, so skipped. */
  skipped: string[];
  /** Read fine but had no cards in Verbatim format (headings only, or notes). */
  empty: string[];
  failed: { name: string; error: string }[];
  cancelled: boolean;
}

/**
 * Read every file and save its cards. Cards are saved in batches (about every
 * 2,000 cards), each batch in one database step, and the screen is given a
 * moment between files so the progress bar moves and Cancel works.
 */
export async function importMany(
  files: readonly PendingFile[],
  opts: { unknownSide: CardSide; onProgress: (p: BulkProgress) => void; cancelled: () => boolean },
): Promise<BulkResult> {
  const topicId = activeTopic()?.id ?? '';
  const already = importedPacks();
  const result: BulkResult = { files: 0, cards: 0, skipped: [], empty: [], failed: [], cancelled: false };
  const seen = new Set<string>();
  let batch: Card[] = [];
  const flush = async () => {
    const out = batch;
    batch = [];
    await db.cards.putMany(out);
  };

  for (let i = 0; i < files.length; i++) {
    if (opts.cancelled()) {
      result.cancelled = true;
      break;
    }
    const f = files[i];
    const info = parseLibraryName(f.name);
    const folder = f.folders[f.folders.length - 1] ?? '';
    // Two different files can share a name in different folders, so the folder is part of the key.
    const pack = folder ? `${folder}/${info.pack}` : info.pack;
    opts.onProgress({ done: i, total: files.length, cards: result.cards, current: f.name });
    // Let the screen draw before the (blocking) read of the next file.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (already.has(pack) || seen.has(pack)) {
      result.skipped.push(f.name);
      continue;
    }
    seen.add(pack);
    try {
      const parsed = extractCards(await readDocx(await f.read()));
      if (!parsed.cards.length) {
        result.empty.push(f.name);
        continue;
      }
      const fileLabels = [info.argument, folder].map((l) => l.trim()).filter(Boolean);
      const t = now();
      parsed.cards.forEach((c, n) => {
        batch.push({
          id: newId(),
          createdAt: t + n, // keeps the file's order when sorted by date
          updatedAt: t + n, // equal to createdAt = not edited since import (see Card.pack)
          topicId,
          kind: 'evidence',
          side: info.side ?? opts.unknownSide,
          tag: c.tag,
          tagDraft: false,
          cite: { ...emptyCite(), last: c.last, year: c.year },
          citeRaw: c.citeRaw,
          citeUnverified: [],
          text: c.text,
          marks: c.marks,
          source: null,
          origin: 'import',
          aiMarked: false,
          labels: [...new Set([...fileLabels, ...c.path.slice(-1).map((l) => l.trim())].filter(Boolean))],
          term: '',
          notes: '',
          pack,
        });
      });
      result.files++;
      result.cards += parsed.cards.length;
      if (batch.length >= 2000) await flush();
    } catch (err) {
      result.failed.push({ name: f.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await flush();
  opts.onProgress({ done: files.length, total: files.length, cards: result.cards, current: '' });
  return result;
}

/**
 * Remove the cards that came in through "Import many files" (for the active
 * topic), so they can be imported again from the same files. Cards you edited
 * or used in a block or T file are your work and are kept: they become
 * ordinary cards.
 */
export async function removeImportedLibrary(): Promise<{ removed: number; kept: number }> {
  const topicId = activeTopic()?.id;
  const untouched = untouchedPackCardIds();
  const mine = db.cards.list.value.filter((c) => c.pack && c.topicId === topicId);
  const remove = mine.filter((c) => untouched.has(c.id)).map((c) => c.id);
  const keep = mine.filter((c) => !untouched.has(c.id)).map(({ pack: _pack, ...c }) => ({ ...c, updatedAt: now() }) as Card);
  await db.cards.removeManyForGood(remove);
  await db.cards.putMany(keep);
  return { removed: remove.length, kept: keep.length };
}
