// Blocks, templates and topicality files.
import { beforeEach, describe, expect, it } from 'vitest';
import { blanksOf, fillBlanks, PRESET_TEMPLATES, presetTemplates, splitBlanks, unfilledCount } from '../../src/core/blocks/templates';
import { emptyCite } from '../../src/core/cards/cite';
import { documentXml } from '../../src/core/docx/write';
import { defaultSettings } from '../../src/core/debate/topics';
import { openBackend } from '../../src/data/db';
import { closeStoreForTests, db, flushWrites, initStore } from '../../src/data/store';
import { resetLockForTests, lockState } from '../../src/ai/lock';
import { blockFromTemplate, blockTitle, blockToItems, newBlock, newTFile, tFileTitle, tFileToItems, tFileToText } from '../../src/features/blocks/blockService';
import { createCard, ensureSource } from '../../src/features/cards/cardService';

let dbName = '';
beforeEach(async () => {
  closeStoreForTests();
  resetLockForTests();
  dbName = `blocks-${Math.random().toString(36).slice(2)}`;
  await initStore(await openBackend(dbName));
});

function makeCard(kind: 'evidence' | 'definition' = 'evidence') {
  const text = 'To establish means to bring into existence, not to modify something that already exists.';
  const source = ensureSource({ kind: 'paste', name: 'Dictionary', url: '', text, meta: '' });
  return createCard({ cut: { text, start: 0, marks: [{ s: 0, e: 12, lv: 2 }] }, source, side: 'neg', tag: [{ t: 'Establish means create' }], tagDraft: false, cite: { ...emptyCite('AB'), last: 'Garner', year: '2024' }, citeUnverified: [], labels: [], kind, term: kind === 'definition' ? 'establish' : '', aiMarked: false });
}

describe('fill-in-the-blank templates', () => {
  it('finds blanks, but not [[underline]] markup or long bracketed passages', () => {
    const text = 'They dropped [argument] in the [speech]. Extend [[this phrase]] and [argument] again. [' + 'x'.repeat(80) + ']';
    expect(blanksOf(text)).toEqual(['argument', 'speech']);
    expect(splitBlanks('a [b] c')).toEqual([{ text: 'a ' }, { blank: 'b' }, { text: ' c' }]);
    expect(splitBlanks('no blanks')).toEqual([{ text: 'no blanks' }]);
  });

  it('fills blanks and leaves unfilled ones visible', () => {
    const body = 'They dropped [argument] in the [speech].';
    expect(fillBlanks(body, { argument: 'the link turn' })).toBe('They dropped the link turn in the [speech].');
    expect(fillBlanks(body, { argument: '  ', speech: '2AC' })).toBe('They dropped [argument] in the 2AC.');
    expect(fillBlanks(body, undefined)).toBe(body);
    expect(unfilledCount(body, { speech: '2AC' })).toBe(1);
  });

  it('ships the presets the brief asks for, each with blanks', () => {
    const titles = PRESET_TEMPLATES.map((t) => t.title).join(' | ');
    for (const need of ['Dropped argument', 'No evidence', 'Evidence comparison', 'Extension structure', 'Impact calculus', 'Permutation', 'conditionality', 'New-in-the-2']) {
      expect(titles.toLowerCase()).toContain(need.toLowerCase());
    }
    for (const t of PRESET_TEMPLATES) expect(blanksOf(t.body).length, t.title).toBeGreaterThan(1);
    const comparison = PRESET_TEMPLATES.find((t) => t.key === 'evidence-comparison')!.body;
    for (const idea of ['Recency', 'Qualifications', 'Warrants', 'Data']) expect(comparison).toContain(idea);
    const impact = PRESET_TEMPLATES.find((t) => t.key === 'impact-calc')!.body;
    for (const idea of ['Magnitude', 'Probability', 'Timeframe', 'Turns the case']) expect(impact).toContain(idea);
    expect(PRESET_TEMPLATES.find((t) => t.key === 'dropped')!.body).toContain('Dropped arguments are treated as true, and that means [impact].');
  });

  it('presets are added once, are editable, and a deleted preset stays deleted', async () => {
    expect(db.templates.list.value).toHaveLength(PRESET_TEMPLATES.length);
    const first = db.templates.list.value[0];
    db.templates.put({ ...first, body: 'My own wording with a [blank].' });
    db.templates.remove(db.templates.list.value[1].id, 'template');
    await flushWrites();
    closeStoreForTests();
    lockState.value = null;
    await initStore(await openBackend(dbName));
    expect(db.templates.list.value).toHaveLength(PRESET_TEMPLATES.length - 1);
    expect(db.templates.get(first.id)!.body).toBe('My own wording with a [blank].');
    expect(presetTemplates(5)[0].builtIn).toBe(true);
  });
});

describe('blocks', () => {
  it('keep your own points and carded points clearly apart when exported', () => {
    const card = makeCard();
    const block = newBlock({
      side: 'aff',
      speech: '2AC',
      answersTo: 'Econ DA',
      items: [
        { id: 'a', kind: 'analytic', text: 'Non-unique: spending is rising now.' },
        { id: 'b', kind: 'card', cardId: card.id },
        { id: 'c', kind: 'analytic', text: '   ' }, // empty points are skipped and not numbered
        { id: 'd', kind: 'heading', text: 'Impact' },
        { id: 'e', kind: 'analytic', text: 'No impact: [reason].' },
        { id: 'f', kind: 'card', cardId: 'deleted-card' }, // a card that no longer exists is left out
      ],
    });
    expect(blockTitle(block)).toBe('2AC Aff: Econ DA');
    const items = blockToItems(block, { reason: 'markets adjust' });
    expect(items.map((i) => i.kind)).toEqual(['heading', 'text', 'card', 'text', 'text']);
    expect(items[1]).toEqual({ kind: 'text', text: '1. Non-unique: spending is rising now.' });
    expect(items[2]).toMatchObject({ kind: 'card', side: 'aff' }); // read by the aff, so highlighted blue
    expect(items[4]).toEqual({ kind: 'text', text: '2. No impact: markets adjust.' });
    // In the file, analytics use the Analytic style and the card keeps its Heading 4 tag.
    const xml = documentXml(items, defaultSettings().highlight);
    expect(xml).toContain('<w:pStyle w:val="Heading3"/>');
    expect(xml.match(/<w:pStyle w:val="Analytic"\/>/g)).toHaveLength(3);
    expect(xml.match(/<w:pStyle w:val="Heading4"\/>/g)).toHaveLength(1);
    expect(xml).toContain('w:fill="8FD3FF"');
  });

  it('a template becomes a block with one point per line', () => {
    const t = presetTemplates(0).find((p) => p.id === 'preset-dropped')!;
    const block = blockFromTemplate(t, { argument: 'the link turn', speech: '2NC' });
    expect(block.items).toHaveLength(4);
    expect(block.items[0]).toMatchObject({ kind: 'analytic', text: 'They dropped the link turn in the 2NC.' });
    expect(block.items[1]).toMatchObject({ text: 'Extend [tag / author].' });
  });
});

describe('topicality files', () => {
  it('a new shell has interpretation, violation, standards and voters; answers have the aff parts', () => {
    expect(newTFile('shell', 'establish').sections.map((s) => s.role)).toEqual(['interp', 'violation', 'standard', 'standard', 'standard', 'voter', 'voter']);
    expect(newTFile('answers', 'establish').sections.map((s) => s.role)).toEqual(['we-meet', 'counter-interp', 'reasonability', 'offense']);
    expect(tFileTitle(newTFile('shell', 'establish'))).toBe('T: establish');
  });

  it('exports in shell order with the definition card under the interpretation, skipping switched-off and empty parts', () => {
    const def = makeCard('definition');
    const f = newTFile('shell', 'establish');
    f.about = 'ACA expansion';
    const set = (role: string, n: number, patch: object) => Object.assign(f.sections.filter((s) => s.role === role)[n], patch);
    set('interp', 0, { text: 'Establish means to create something new.', cardId: def.id });
    set('violation', 0, { text: 'The plan expands an existing program.' });
    set('standard', 0, { text: 'Their interpretation allows any change to any program.' });
    set('standard', 1, { text: 'We lose spending disads.', on: false });
    set('voter', 0, { text: 'Fairness.' });
    f.sections.push({ id: 'x', role: 'extension', title: '2NR overview', text: 'T is the whole 2NR.', speech: '2NR', on: true });
    const items = tFileToItems(f);
    const texts = items.map((i) => (i.kind === 'card' ? 'CARD' : i.text));
    expect(texts).toEqual([
      'T: establish (vs ACA expansion)',
      'A. Interpretation',
      'Establish means to create something new.',
      'CARD',
      'B. Violation',
      'The plan expands an existing program.',
      'C. Standards',
      'Limits: Their interpretation allows any change to any program.',
      'D. Voters',
      'Fairness: Fairness.',
      '2NR 2NR overview',
      'T is the whole 2NR.',
    ]);
    expect(tFileToText(f)).toContain('To establish means to bring into existence');
    expect(tFileToItems(f, (s) => s.role !== 'extension').some((i) => i.kind === 'text' && i.text.includes('2NR'))).toBe(false);
  });
});
