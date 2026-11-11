// The flow model: building the tree, laying it out, spotting dropped arguments,
// and surviving damaged saved data.
import { describe, expect, it } from 'vitest';
import {
  addChild,
  addRoot,
  addSibling,
  allowedColumns,
  answerWindow,
  buildColumns,
  columnOrder,
  createSheet,
  dropStatus,
  isExtension,
  latestSpeechFlowed,
  layoutSheet,
  moveCell,
  neighbour,
  removeCell,
  reparent,
  repairSheet,
  sheetToText,
  shiftColumn,
  subtreeIds,
  updateCell,
  type FlowSheet,
} from '../../src/core/flow/model';
import { cleanAbbreviations, expandAtCaret, expandAtEnd } from '../../src/core/flow/abbrev';
import { SPEECHES } from '../../src/core/debate/formats';

const idx = (s: string) => SPEECHES.indexOf(s as (typeof SPEECHES)[number]);

/** A small DA flow: 1NC link + impact, 2AC answers to the link. */
function daSheet() {
  let sheet = createSheet('Econ DA', 'da', false);
  const link = addRoot(sheet, 0, null, 'Link: spending');
  sheet = link.sheet;
  const impact = addRoot(sheet, 0, link.id, 'Impact: recession');
  sheet = impact.sheet;
  const noLink = addChild(sheet, link.id, 'answer', 'No link')!;
  sheet = noLink.sheet;
  const turn = addChild(sheet, link.id, 'answer', 'Link turn')!;
  sheet = turn.sheet;
  return { sheet, link: link.id, impact: impact.id, noLink: noLink.id, turn: turn.id };
}

describe('columns', () => {
  it('case sheets have one column per speech', () => {
    expect(createSheet('Case', 'case', false).columns).toEqual(['1AC', '1NC', '2AC', '2NC', '1NR', '1AR', '2NR', '2AR']);
  });
  it('off-case sheets start at the 1NC', () => {
    for (const kind of ['da', 'cp', 'k', 't'] as const) {
      expect(createSheet('x', kind, false).columns[0]).toBe('1NC');
      expect(createSheet('x', kind, false).columns).toHaveLength(7);
    }
  });
  it('can merge the block into one column', () => {
    expect(buildColumns('1AC', true)).toEqual(['1AC', '1NC', '2AC', 'BLOCK', '1AR', '2NR', '2AR']);
    expect(buildColumns('1NC', true)).toEqual(['1NC', '2AC', 'BLOCK', '1AR', '2NR', '2AR']);
    expect(buildColumns('1NR', true)[0]).toBe('BLOCK');
  });
});

describe('building a flow', () => {
  it('puts answers in the other team\'s next speech and extensions in your own', () => {
    const { sheet, link, noLink } = daSheet();
    expect(sheet.columns[sheet.cells[noLink].col]).toBe('2AC');
    // Neg extends its own link: next NEG speech after the 1NC is the 2NC.
    const ext = addChild(sheet, link, 'extend', 'Extend link')!;
    expect(ext.sheet.columns[ext.sheet.cells[ext.id].col]).toBe('2NC');
    expect(isExtension(ext.sheet, ext.sheet.cells[ext.id])).toBe(true);
    expect(isExtension(sheet, sheet.cells[noLink])).toBe(false);
    // Aff answers a 2NC argument in the 1AR, skipping the 1NR.
    const block = addChild(sheet, noLink, 'answer', 'They link')!;
    const oneAr = addChild(block.sheet, block.id, 'answer', 'Still no link')!;
    expect(block.sheet.columns[block.sheet.cells[block.id].col]).toBe('2NC');
    expect(oneAr.sheet.columns[oneAr.sheet.cells[oneAr.id].col]).toBe('1AR');
  });

  it('nothing can answer the 2AR', () => {
    let sheet = createSheet('Case', 'case', false);
    const r = addRoot(sheet, 7, null, '2AR point');
    sheet = r.sheet;
    expect(addChild(sheet, r.id, 'answer')).toBeNull();
    expect(addChild(sheet, r.id, 'extend')).toBeNull();
  });

  it('does not change the sheet it was given', () => {
    const { sheet, link } = daSheet();
    const before = JSON.stringify(sheet);
    addChild(sheet, link, 'answer', 'x');
    addSibling(sheet, link, 'y');
    removeCell(sheet, link, true);
    updateCell(sheet, link, { text: 'changed' });
    expect(JSON.stringify(sheet)).toBe(before);
  });

  it('adds siblings right below', () => {
    const { sheet, link, noLink, turn } = daSheet();
    const s = addSibling(sheet, noLink, 'Non-unique')!;
    expect(s.sheet.cells[link].kids).toEqual([noLink, s.id, turn]);
    const r = addSibling(sheet, link, 'Internal link')!;
    expect(r.sheet.roots[1]).toBe(r.id);
  });

  it('removing a cell keeps or removes its answers as asked', () => {
    const { sheet, link, impact, noLink, turn } = daSheet();
    const kept = removeCell(sheet, link, false);
    expect(kept.roots).toEqual([noLink, turn, impact]);
    expect(kept.cells[noLink].parent).toBeNull();
    const gone = removeCell(sheet, link, true);
    expect(Object.keys(gone.cells)).toEqual([impact]);
    expect(gone.roots).toEqual([impact]);
  });

  it('moves cells up and down and between neighbouring speeches', () => {
    const { sheet, link, noLink, turn } = daSheet();
    expect(moveCell(sheet, turn, -1).cells[link].kids).toEqual([turn, noLink]);
    expect(moveCell(sheet, turn, 1)).toBe(sheet); // already last
    // A block answer can slide from the 2NC to the 1NR, but not past its own answers or before its parent.
    const block = addChild(sheet, noLink, 'answer', 'ext')!;
    const slid = shiftColumn(block.sheet, block.id, 1);
    expect(slid.columns[slid.cells[block.id].col]).toBe('1NR');
    expect(shiftColumn(block.sheet, block.id, -1)).toBe(block.sheet);
    expect(allowedColumns(block.sheet, noLink)).toEqual({ min: 1, max: 1 });
  });

  it('re-links answers, refusing impossible links', () => {
    const { sheet, link, impact, noLink } = daSheet();
    const moved = reparent(sheet, noLink, impact) as FlowSheet;
    expect(moved.cells[noLink].parent).toBe(impact);
    expect(moved.cells[link].kids).not.toContain(noLink);
    expect(moved.cells[impact].kids).toContain(noLink);
    expect(reparent(sheet, link, noLink)).toHaveProperty('error'); // would be a loop
    expect(reparent(sheet, link, impact)).toHaveProperty('error'); // same column
    const top = reparent(sheet, noLink, null) as FlowSheet;
    expect(top.roots).toContain(noLink);
    expect(reparent(sheet, noLink, link)).toBe(sheet); // already there
  });
});

describe('layout', () => {
  it('an argument is as tall as its answers, and answers sit beside it', () => {
    const { sheet, link, impact, noLink, turn } = daSheet();
    const lay = layoutSheet(sheet);
    expect(lay.pos[link]).toEqual({ row: 0, span: 2 });
    expect(lay.pos[noLink]).toEqual({ row: 0, span: 1 });
    expect(lay.pos[turn]).toEqual({ row: 1, span: 1 });
    expect(lay.pos[impact]).toEqual({ row: 2, span: 1 });
    expect(lay.rows).toBe(3);
  });

  it('no two cells in a column overlap, even in a big random flow', () => {
    let sheet = createSheet('Case', 'case', false);
    const ids: string[] = [];
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let i = 0; i < 300; i++) {
      const roll = rnd(10);
      if (!ids.length || roll < 2) {
        const r = addRoot(sheet, rnd(8), null, `r${i}`);
        sheet = r.sheet;
        ids.push(r.id);
      } else {
        const r = addChild(sheet, ids[rnd(ids.length)], roll < 8 ? 'answer' : 'extend', `c${i}`);
        if (r) {
          sheet = r.sheet;
          ids.push(r.id);
        }
      }
    }
    const lay = layoutSheet(sheet);
    expect(Object.keys(lay.pos)).toHaveLength(Object.keys(sheet.cells).length);
    for (let col = 0; col < sheet.columns.length; col++) {
      let end = 0;
      for (const id of columnOrder(sheet, lay, col)) {
        expect(lay.pos[id].row).toBeGreaterThanOrEqual(end);
        end = lay.pos[id].row + lay.pos[id].span;
      }
    }
    // Every answer lies inside its parent's rows and in a later column.
    for (const cell of Object.values(sheet.cells)) {
      if (!cell.parent) continue;
      const p = lay.pos[cell.parent];
      const c = lay.pos[cell.id];
      expect(c.row).toBeGreaterThanOrEqual(p.row);
      expect(c.row + c.span).toBeLessThanOrEqual(p.row + p.span);
      expect(cell.col).toBeGreaterThan(sheet.cells[cell.parent].col);
    }
    // And the checker agrees the tree is sound.
    expect(JSON.stringify(repairSheet(sheet))).toBe(JSON.stringify(sheet));
  });

  it('arrow keys go where you expect', () => {
    const { sheet, link, impact, noLink, turn } = daSheet();
    const lay = layoutSheet(sheet);
    expect(neighbour(sheet, lay, link, 'down')).toBe(impact);
    expect(neighbour(sheet, lay, impact, 'up')).toBe(link);
    expect(neighbour(sheet, lay, link, 'right')).toBe(noLink);
    expect(neighbour(sheet, lay, noLink, 'down')).toBe(turn);
    expect(neighbour(sheet, lay, turn, 'left')).toBe(link);
    expect(neighbour(sheet, lay, link, 'up')).toBeNull();
    // No answers of its own: step to the nearest cell in the next column.
    expect(neighbour(sheet, lay, impact, 'right')).toBe(turn);
    expect(neighbour(sheet, lay, noLink, 'right')).toBeNull();
  });
});

describe('dropped arguments', () => {
  it('knows when the other team gets to answer', () => {
    const cs = createSheet('Case', 'case', false);
    const labels = (col: number) => answerWindow(cs, col).map((i) => cs.columns[i]);
    expect(labels(0)).toEqual(['1NC']);
    expect(labels(1)).toEqual(['2AC']);
    expect(labels(2)).toEqual(['2NC', '1NR']); // the whole block answers the 2AC
    expect(labels(3)).toEqual(['1AR']); // the 1NR is the same team, so the 1AR answers the 2NC
    expect(labels(4)).toEqual(['1AR']);
    expect(labels(5)).toEqual(['2NR']);
    expect(labels(6)).toEqual(['2AR']);
    expect(labels(7)).toEqual([]);
  });

  it('hints only once the chance to answer has passed', () => {
    const { sheet, link, impact, noLink } = daSheet();
    // During the 2AC nothing is dropped yet.
    expect(dropStatus(sheet, impact, idx('2AC'))).toBe('ok');
    // Once the 2NC starts, the unanswered 1NC impact is flagged; the answered link is not.
    expect(dropStatus(sheet, impact, idx('2NC'))).toBe('maybe-dropped');
    expect(dropStatus(sheet, link, idx('2NC'))).toBe('ok');
    // A 2AC answer is not "dropped" until the block is over (1AR has begun).
    expect(dropStatus(sheet, noLink, idx('1NR'))).toBe('ok');
    expect(dropStatus(sheet, noLink, idx('1AR'))).toBe('maybe-dropped');
  });

  it('your own marks win over the hint', () => {
    const { sheet, impact } = daSheet();
    expect(dropStatus(updateCell(sheet, impact, { dropped: true }), impact, idx('1NC'))).toBe('dropped');
    expect(dropStatus(updateCell(sheet, impact, { dropped: false }), impact, idx('2AR'))).toBe('ok');
  });

  it('an extension by the same team does not count as an answer; an empty cell is never dropped', () => {
    const { sheet, impact } = daSheet();
    const ext = addChild(sheet, impact, 'extend', 'Extend impact')!;
    expect(dropStatus(ext.sheet, impact, idx('1AR'))).toBe('maybe-dropped');
    const blankAnswer = addChild(sheet, impact, 'answer', '   ')!;
    expect(dropStatus(blankAnswer.sheet, impact, idx('1AR'))).toBe('maybe-dropped');
    expect(dropStatus(blankAnswer.sheet, blankAnswer.id, idx('2AR'))).toBe('ok');
  });

  it('works out how far the round has got from what is written', () => {
    const { sheet } = daSheet();
    expect(latestSpeechFlowed([sheet])).toBe(idx('2AC'));
    expect(latestSpeechFlowed([createSheet('Case', 'case', false)])).toBe(-1);
  });
});

describe('damaged saved flows are repaired, never crash', () => {
  it('fixes missing links, orphans, loops and bad columns', () => {
    const { sheet, link, noLink, turn } = daSheet();
    const broken = JSON.parse(JSON.stringify(sheet)) as FlowSheet;
    broken.cells[link].kids.push('does-not-exist', noLink); // dangling + duplicate
    broken.cells[turn].kids.push(link); // loop
    broken.cells[noLink].col = 0; // same column as its parent
    broken.cells['orphan'] = { id: 'orphan', col: 99, parent: 'nobody', kids: [], text: 'lost' };
    (broken.cells as Record<string, unknown>)['junk'] = null;
    broken.roots.push('ghost');
    const fixed = repairSheet(broken);
    const lay = layoutSheet(fixed);
    expect(Object.keys(lay.pos).sort()).toEqual(Object.keys(fixed.cells).sort());
    expect(fixed.cells[link].kids).toEqual([noLink, turn]);
    expect(fixed.cells[turn].kids).toEqual([]);
    expect(fixed.cells[noLink].col).toBe(1);
    expect(fixed.roots).toContain('orphan');
    expect(fixed.cells.orphan.col).toBe(fixed.columns.length - 1);
    expect(fixed.cells.orphan.parent).toBeNull();
    expect(fixed.cells.junk).toBeUndefined();
    // Repairing twice changes nothing more.
    expect(JSON.stringify(repairSheet(fixed))).toBe(JSON.stringify(fixed));
  });

  it('copes with a sheet that is almost empty', () => {
    const fixed = repairSheet({ name: 'x' } as unknown as FlowSheet);
    expect(fixed.columns.length).toBe(8);
    expect(fixed.roots).toEqual([]);
  });
});

describe('text export', () => {
  it('writes an indented outline', () => {
    const { sheet, impact } = daSheet();
    const text = sheetToText(updateCell(sheet, impact, { dropped: true }));
    expect(text).toContain('## Econ DA (Disadvantage)');
    expect(text).toContain('- [1NC] Link: spending');
    expect(text).toContain('  - [2AC] No link');
    expect(text).toContain('- [1NC] Impact: recession {DROPPED}');
    expect(subtreeIds(sheet, sheet.roots[0])).toHaveLength(3);
  });
});

describe('abbreviations', () => {
  const list = [
    { code: 'nu', expansion: 'non-unique' },
    { code: 'T', expansion: 'topicality' },
  ];
  it('expands a code when the word is finished', () => {
    expect(expandAtCaret('nu ', 3, list)).toEqual({ text: 'non-unique ', caret: 11 });
    expect(expandAtCaret('1. nu, more', 6, list)).toEqual({ text: '1. non-unique, more', caret: 14 });
  });
  it('leaves other words alone', () => {
    expect(expandAtCaret('menu ', 5, list)).toBeNull(); // "nu" inside a word
    expect(expandAtCaret('nu', 2, list)).toBeNull(); // not finished yet
    expect(expandAtCaret('t ', 2, list)).toBeNull(); // case-sensitive
    expect(expandAtCaret('nu ', 3, [])).toBeNull();
  });
  it('expands at the end of a cell', () => {
    expect(expandAtEnd('link is nu', list)).toBe('link is non-unique');
    expect(expandAtEnd('link is new', list)).toBe('link is new');
  });
  it('cleans a messy list', () => {
    expect(
      cleanAbbreviations([
        { code: ' nu ', expansion: ' non-unique ' },
        { code: 'nu', expansion: 'dup' },
        { code: 'has space', expansion: 'x' },
        { code: '', expansion: 'x' },
        { code: 'ok', expansion: '' },
      ]),
    ).toEqual([{ code: 'nu', expansion: 'non-unique' }]);
  });
});
