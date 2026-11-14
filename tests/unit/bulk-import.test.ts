// "Import many files": a whole .zip or folder of evidence files at once, and
// what a big imported library means for backups and restore.
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyCite } from '../../src/core/cards/cite';
import { defaultSettings } from '../../src/core/debate/topics';
import { buildDocx } from '../../src/core/docx/write';
import { searchItems } from '../../src/core/search';
import { openBackend } from '../../src/data/db';
import { closeStoreForTests, currentSnapshot, db, flushWrites, initStore, restoreSnapshot, untouchedPackCardIds } from '../../src/data/store';
import { resetLockForTests } from '../../src/ai/lock';
import { collectFiles, importMany, parseLibraryName, removeImportedLibrary } from '../../src/features/library/bulkImport';
import type { CardSide } from '../../src/data/schema';

let n = 0;
async function freshStore(name = `bulk-${++n}-${Math.random().toString(36).slice(2)}`) {
  closeStoreForTests();
  resetLockForTests();
  await initStore(await openBackend(name));
  return name;
}

/** A small Verbatim-style evidence file with `count` cards under one block heading. */
async function evidenceFile(block: string, count: number): Promise<Uint8Array> {
  const cards = Array.from({ length: count }, (_, i) => ({
    kind: 'card' as const,
    side: 'neg' as const,
    card: {
      tag: [{ t: `${block} card ${i + 1}` }],
      cite: { ...emptyCite('AB'), last: 'Okafor', year: '2026', title: 'Title', publication: 'Review' },
      text: `Evidence number ${i + 1} about ${block}. Markets collapse when spending rises.`,
      marks: [{ s: 0, e: 10, lv: 2 as const }],
    },
  }));
  return buildDocx([{ kind: 'heading', level: 3, text: block }, ...cards], defaultSettings().highlight);
}

async function zipOf(entries: Record<string, Uint8Array | string>): Promise<File> {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(entries)) zip.file(path, data);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes as BlobPart], 'Debate_Library.zip', { type: 'application/zip' });
}

const run = (files: Awaited<ReturnType<typeof collectFiles>>['files'], unknownSide: CardSide = 'both') =>
  importMany(files, { unknownSide, onProgress: () => {}, cancelled: () => false });

beforeEach(async () => {
  await freshStore();
});

describe('reading the side and argument from a file name', () => {
  it('handles the camp-library pattern', () => {
    expect(parseLibraryName('Econ DA - Neg - DDI 2026 BMW.docx')).toEqual({ pack: 'Econ DA - Neg - DDI 2026 BMW', argument: 'Econ DA', side: 'neg', camp: 'DDI 2026 BMW' });
    expect(parseLibraryName('AT States CP - Aff - Michigan 2026 BCFP.docx').side).toBe('aff');
    expect(parseLibraryName('Midterms Updates - General - Wake 2026.docx').side).toBe('both');
    // A dash inside the argument name does not confuse it.
    expect(parseLibraryName('Cap K - Movements Alt - Neg - Michigan 2026.docx')).toMatchObject({ argument: 'Cap K - Movements Alt', side: 'neg' });
  });
  it('a name that does not say gives no side', () => {
    expect(parseLibraryName('My blocks.docx')).toEqual({ pack: 'My blocks', argument: 'My blocks', side: null, camp: '' });
  });
});

describe('importing a .zip', () => {
  it('adds every card with side and labels from the name and folder, skipping junk', async () => {
    const file = await zipOf({
      'Debate Library/Disadvantages/Econ DA - Neg - DDI 2026.docx': await evidenceFile('Econ Link', 3),
      'Debate Library/Disadvantages/Econ DA - Aff - DDI 2026.docx': await evidenceFile('No Link', 2),
      'Debate Library/Kritiks/Cap K - General - Wake 2026.docx': await evidenceFile('Alt', 1),
      'Debate Library/Misc/Notes.docx': await evidenceFile('Notes', 1),
      'Debate Library/_INDEX.txt': 'index',
      '__MACOSX/Debate Library/._Econ DA - Neg - DDI 2026.docx': 'junk',
      'Debate Library/Disadvantages/~$on DA - Neg - DDI 2026.docx': 'lock file',
    });
    const { files, ignored } = await collectFiles([file]);
    expect(files.map((f) => f.name)).toEqual(['Econ DA - Aff - DDI 2026.docx', 'Econ DA - Neg - DDI 2026.docx', 'Cap K - General - Wake 2026.docx', 'Notes.docx']);
    expect(ignored).toBe(3);

    const res = await run(files, 'aff');
    expect(res).toMatchObject({ files: 4, cards: 7, skipped: [], empty: [], failed: [], cancelled: false });
    await flushWrites();
    const cards = db.cards.list.value;
    expect(cards).toHaveLength(7);
    const neg = cards.filter((c) => c.pack === 'Disadvantages/Econ DA - Neg - DDI 2026');
    expect(neg).toHaveLength(3);
    expect(neg.every((c) => c.side === 'neg' && c.origin === 'import')).toBe(true);
    expect(neg[0].labels).toEqual(['Econ DA', 'Disadvantages', 'Econ Link']);
    expect(neg.map((c) => c.tag[0].t)).toEqual(['Econ Link card 1', 'Econ Link card 2', 'Econ Link card 3']);
    expect(cards.find((c) => c.pack === 'Kritiks/Cap K - General - Wake 2026')!.side).toBe('both');
    expect(cards.find((c) => c.pack === 'Misc/Notes')!.side).toBe('aff'); // the side picked for names that do not say
  });

  it('is saved for real, and running it again adds nothing', async () => {
    const name = `bulk-reload-${Math.random()}`;
    await freshStore(name);
    const file = await zipOf({ 'A/Econ DA - Neg - DDI.docx': await evidenceFile('X', 2), 'A/Econ DA - Aff - DDI.docx': await evidenceFile('Y', 2) });
    await run((await collectFiles([file])).files);
    await flushWrites();
    // Reopen the same database, as after restarting the app.
    await freshStore(name);
    expect(db.cards.list.value).toHaveLength(4);
    const again = await run((await collectFiles([file])).files);
    expect(again).toMatchObject({ files: 0, cards: 0, skipped: ['Econ DA - Aff - DDI.docx', 'Econ DA - Neg - DDI.docx'] });
    expect(db.cards.list.value).toHaveLength(4);
  });

  it('two different files with the same name in different folders are both imported', async () => {
    const file = await zipOf({ 'Updates/Balancing - Aff - X.docx': await evidenceFile('One', 1), 'Affs/Balancing - Aff - X.docx': await evidenceFile('Two', 2) });
    const res = await run((await collectFiles([file])).files);
    expect(res).toMatchObject({ files: 2, cards: 3, skipped: [] });
  });

  it('reports files with no cards and files that cannot be read, and keeps going', async () => {
    const empty = await buildDocx([{ kind: 'heading', level: 3, text: 'Only a heading' }], defaultSettings().highlight);
    const file = await zipOf({ 'Empty - Neg - X.docx': empty, 'Broken - Neg - X.docx': 'not a docx', 'Good - Neg - X.docx': await evidenceFile('G', 1) });
    const res = await run((await collectFiles([file])).files);
    expect(res.empty).toEqual(['Empty - Neg - X.docx']);
    expect(res.failed.map((f) => f.name)).toEqual(['Broken - Neg - X.docx']);
    expect(res.cards).toBe(1);
  });

  it('Stop leaves what was already imported', async () => {
    const file = await zipOf({ 'A - Neg - X.docx': await evidenceFile('A', 1), 'B - Neg - X.docx': await evidenceFile('B', 1) });
    const { files } = await collectFiles([file]);
    let calls = 0;
    const res = await importMany(files, { unknownSide: 'both', onProgress: () => {}, cancelled: () => ++calls > 1 });
    expect(res.cancelled).toBe(true);
    expect(res.files).toBe(1);
    expect(db.cards.list.value).toHaveLength(1);
  });

  it('a .zip that is not a zip gives a clear message', async () => {
    await expect(collectFiles([new File(['nope'], 'Library.zip')])).rejects.toThrow(/could not be opened as a \.zip/);
  });

  it('loose .docx files and a picked folder work too', async () => {
    const bytes = await evidenceFile('Loose', 1);
    const loose = new File([bytes as BlobPart], 'Courts CP - Neg - DDI.docx');
    const inFolder = new File([bytes as BlobPart], 'States CP - Aff - DDI.docx');
    Object.defineProperty(inFolder, 'webkitRelativePath', { value: 'Debate Library/Counterplans/States CP - Aff - DDI.docx' });
    const { files } = await collectFiles([loose, inFolder]);
    await run(files);
    const states = db.cards.list.value.find((c) => c.pack === 'Counterplans/States CP - Aff - DDI')!;
    expect(states.labels).toEqual(['States CP', 'Counterplans', 'Loose']);
    expect(db.cards.list.value.find((c) => c.pack === 'Courts CP - Neg - DDI')!.labels).toEqual(['Courts CP', 'Loose']);
  });
});

describe('a big imported library and backups', () => {
  async function importSome() {
    const file = await zipOf({ 'D/Econ DA - Neg - X.docx': await evidenceFile('E', 3) });
    await run((await collectFiles([file])).files);
    await flushWrites();
  }

  it('automatic backups leave out untouched imported cards, but keep edited ones and ones used in blocks', async () => {
    await importSome();
    const [a, b, c] = db.cards.list.value;
    expect(untouchedPackCardIds().size).toBe(3);
    db.cards.put({ ...a, notes: 'my note' }); // edited
    const block = db.blocks.list.value[0];
    expect(block).toBeUndefined();
    db.blocks.put({ id: 'blk', createdAt: 1, updatedAt: 1, topicId: a.topicId, title: 'B', side: 'neg', speech: 'any', category: 'da', answersTo: '', items: [{ id: 'i', kind: 'card', cardId: b.id }], notes: '' } as never);
    const lean = currentSnapshot(true).data.cards.map((x) => x.id).sort();
    expect(lean).toEqual([a.id, b.id].sort());
    expect(lean).not.toContain(c.id);
    // The backup file you download yourself has everything.
    expect(currentSnapshot().data.cards).toHaveLength(3);
  });

  it('restoring an automatic backup keeps the imported library', async () => {
    const before = currentSnapshot(true); // taken before the import
    await importSome();
    await restoreSnapshot(before);
    expect(db.cards.list.value.filter((c) => c.pack)).toHaveLength(3);
  });

  it('"Remove them" takes out untouched imported cards and keeps your work', async () => {
    await importSome();
    const [a] = db.cards.list.value;
    db.cards.put({ ...a, notes: 'mine' });
    const res = await removeImportedLibrary();
    expect(res).toEqual({ removed: 2, kept: 1 });
    expect(db.cards.list.value).toHaveLength(1);
    expect(db.cards.list.value[0].pack).toBeUndefined();
    expect(db.cards.list.value[0].notes).toBe('mine');
  });
});

describe('search', () => {
  it('ignores case, keeps phrases, and ranks tag matches first', () => {
    const items = [
      { tag: 'Something else', text: 'the ECONOMY will collapse' },
      { tag: 'Economy collapse now', text: 'x' },
      { tag: 'Unrelated', text: 'nothing here' },
    ];
    const fields = (i: (typeof items)[number]) => [
      { text: i.tag, weight: 6 },
      { text: i.text, weight: 1 },
    ];
    expect(searchItems(items, 'economy', fields).map((i) => i.tag)).toEqual(['Economy collapse now', 'Something else']);
    expect(searchItems(items, '"will collapse"', fields).map((i) => i.tag)).toEqual(['Something else']);
    expect(searchItems(items, 'a.b (c', fields)).toEqual([]); // regex characters are searched for literally
  });
});
