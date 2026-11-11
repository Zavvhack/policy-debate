// The flow: the notes you take during a round.
//
// How it is modelled
// ------------------
// A round has several SHEETS (case, each disad, the counterplan, T, ...).
// A sheet has one COLUMN per speech and a set of CELLS.
//
// Cells form a tree: every cell can have a `parent`, which is the argument it
// answers (or extends). A cell always sits in a later column than its parent.
// The screen layout is worked out from the tree, so an answer always sits
// right next to the thing it answers - you never have to line rows up by hand.
//
//   1NC            2AC             2NC
//   +-----------+  +------------+  +----------------+
//   | Link: ... |->| No link    |->| Extend the link|
//   |           |  +------------+  +----------------+
//   |           |->| Link turn  |     (nothing here = dropped by the neg)
//   +-----------+  +------------+
//
// Everything in this file is plain data and pure functions: no screen code.
// Functions never change the sheet you pass in; they return a new one.

import { newId } from '../ids';
import { SPEECHES, SPEECH_SIDE, type Side, type SpeechId } from '../debate/formats';

/** A column is a speech, or 'BLOCK' when the 2NC and 1NR share one column. */
export type ColumnId = SpeechId | 'BLOCK';

export type SheetKind = 'case' | 'da' | 'cp' | 'k' | 't' | 'theory' | 'other';

export const SHEET_KIND_LABEL: Record<SheetKind, string> = {
  case: 'Case',
  da: 'Disadvantage',
  cp: 'Counterplan',
  k: 'Kritik',
  t: 'Topicality',
  theory: 'Theory',
  other: 'Other',
};

/** Off-case positions are first read in the 1NC, so their sheets have no 1AC column. */
export const SHEET_STARTS_AT: Record<SheetKind, SpeechId> = {
  case: '1AC',
  da: '1NC',
  cp: '1NC',
  k: '1NC',
  t: '1NC',
  theory: '1AC',
  other: '1AC',
};

export interface FlowCell {
  id: string;
  /** Index into sheet.columns. */
  col: number;
  /** The cell this one answers or extends. Null for a fresh argument. */
  parent: string | null;
  /** Cells that answer or extend this one, top to bottom. */
  kids: string[];
  text: string;
  /**
   * Was this argument dropped?
   *   true  = you marked it dropped
   *   false = you said "not dropped" (hides the automatic hint)
   *   undefined = let the app suggest
   */
  dropped?: boolean;
  /** Optional emphasis markers you can toggle. */
  star?: boolean;
  turn?: boolean;
}

export interface FlowSheet {
  id: string;
  name: string;
  kind: SheetKind;
  columns: ColumnId[];
  /** Top-level arguments, top to bottom. */
  roots: string[];
  cells: Record<string, FlowCell>;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export function columnSide(col: ColumnId): Side {
  return col === 'BLOCK' ? 'neg' : SPEECH_SIDE[col];
}

export function columnLabel(col: ColumnId): string {
  return col === 'BLOCK' ? 'Block' : col;
}

/**
 * The columns for a sheet.
 * @param startsAt   first speech shown (off-case sheets start at the 1NC)
 * @param mergeBlock true = one "Block" column for the 2NC and 1NR (like a paper flow)
 */
export function buildColumns(startsAt: SpeechId, mergeBlock: boolean): ColumnId[] {
  const all: ColumnId[] = mergeBlock
    ? ['1AC', '1NC', '2AC', 'BLOCK', '1AR', '2NR', '2AR']
    : [...SPEECHES];
  let from = all.indexOf(startsAt);
  // Starting "at the 2NC or 1NR" when they are merged means starting at the block.
  if (from < 0 && (startsAt === '2NC' || startsAt === '1NR')) from = all.indexOf('BLOCK');
  return all.slice(Math.max(0, from));
}

export function createSheet(name: string, kind: SheetKind, mergeBlock: boolean, startsAt?: SpeechId): FlowSheet {
  return {
    id: newId(),
    name,
    kind,
    columns: buildColumns(startsAt ?? SHEET_STARTS_AT[kind], mergeBlock),
    roots: [],
    cells: {},
  };
}

/** The next column after `col` whose side matches (`same`) or differs from the given side. */
function nextColumn(sheet: FlowSheet, col: number, side: Side, same: boolean): number | null {
  for (let i = col + 1; i < sheet.columns.length; i++) {
    if ((columnSide(sheet.columns[i]) === side) === same) return i;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/** The list a cell lives in: its parent's kids, or the sheet's roots. */
function siblingsOf(sheet: FlowSheet, cell: FlowCell): string[] {
  return cell.parent ? sheet.cells[cell.parent]?.kids ?? [] : sheet.roots;
}

/** A cell and everything below it. */
export function subtreeIds(sheet: FlowSheet, id: string): string[] {
  const out: string[] = [];
  const walk = (cid: string) => {
    const c = sheet.cells[cid];
    if (!c) return;
    out.push(cid);
    c.kids.forEach(walk);
  };
  walk(id);
  return out;
}

/** An extension is a cell on the same side as the argument it is attached to. */
export function isExtension(sheet: FlowSheet, cell: FlowCell): boolean {
  if (!cell.parent) return false;
  const parent = sheet.cells[cell.parent];
  if (!parent) return false;
  return columnSide(sheet.columns[cell.col]) === columnSide(sheet.columns[parent.col]);
}

// ---------------------------------------------------------------------------
// Changing the tree (each returns a NEW sheet)
// ---------------------------------------------------------------------------

function withCells(sheet: FlowSheet, changes: Record<string, FlowCell | undefined>, roots?: string[]): FlowSheet {
  const cells = { ...sheet.cells };
  for (const [id, cell] of Object.entries(changes)) {
    if (cell) cells[id] = cell;
    else delete cells[id];
  }
  return { ...sheet, cells, roots: roots ?? sheet.roots };
}

function insertAfter(list: string[], after: string | null | undefined, id: string): string[] {
  const out = [...list];
  const at = after ? out.indexOf(after) : -1;
  if (at >= 0) out.splice(at + 1, 0, id);
  else out.push(id);
  return out;
}

/** A new top-level argument in a column. */
export function addRoot(sheet: FlowSheet, col: number, afterRootId?: string | null, text = ''): { sheet: FlowSheet; id: string } {
  const c = Math.min(sheet.columns.length - 1, Math.max(0, col));
  const cell: FlowCell = { id: newId(), col: c, parent: null, kids: [], text };
  return { sheet: withCells(sheet, { [cell.id]: cell }, insertAfter(sheet.roots, afterRootId, cell.id)), id: cell.id };
}

/**
 * A new cell attached to `parentId`.
 * @param mode 'answer' puts it in the other team's next speech;
 *             'extend' puts it in the same team's next speech.
 * Returns null if there is no later column to put it in (e.g. answering the 2AR).
 */
export function addChild(
  sheet: FlowSheet,
  parentId: string,
  mode: 'answer' | 'extend' = 'answer',
  text = '',
  afterKidId?: string | null,
): { sheet: FlowSheet; id: string } | null {
  const parent = sheet.cells[parentId];
  if (!parent) return null;
  const side = columnSide(sheet.columns[parent.col]);
  const col = nextColumn(sheet, parent.col, side, mode === 'extend');
  if (col === null) return null;
  const cell: FlowCell = { id: newId(), col, parent: parentId, kids: [], text };
  const updatedParent: FlowCell = { ...parent, kids: insertAfter(parent.kids, afterKidId, cell.id) };
  return { sheet: withCells(sheet, { [cell.id]: cell, [parentId]: updatedParent }), id: cell.id };
}

/** A new cell directly below `id`: same column, attached to the same argument. */
export function addSibling(sheet: FlowSheet, id: string, text = ''): { sheet: FlowSheet; id: string } | null {
  const cell = sheet.cells[id];
  if (!cell) return null;
  const fresh: FlowCell = { id: newId(), col: cell.col, parent: cell.parent, kids: [], text };
  if (cell.parent) {
    const parent = sheet.cells[cell.parent];
    const updatedParent: FlowCell = { ...parent, kids: insertAfter(parent.kids, id, fresh.id) };
    return { sheet: withCells(sheet, { [fresh.id]: fresh, [parent.id]: updatedParent }), id: fresh.id };
  }
  return { sheet: withCells(sheet, { [fresh.id]: fresh }, insertAfter(sheet.roots, id, fresh.id)), id: fresh.id };
}

export function updateCell(sheet: FlowSheet, id: string, patch: Partial<Pick<FlowCell, 'text' | 'dropped' | 'star' | 'turn'>>): FlowSheet {
  const cell = sheet.cells[id];
  if (!cell) return sheet;
  const next: FlowCell = { ...cell, ...patch };
  // Keep saved data small: drop flags that are switched off.
  if (next.dropped === undefined) delete next.dropped;
  if (!next.star) delete next.star;
  if (!next.turn) delete next.turn;
  return withCells(sheet, { [id]: next });
}

/**
 * Remove a cell.
 * @param withAnswers true  = also remove everything attached to it;
 *                    false = keep the attached cells and hook them onto this cell's parent.
 */
export function removeCell(sheet: FlowSheet, id: string, withAnswers: boolean): FlowSheet {
  const cell = sheet.cells[id];
  if (!cell) return sheet;
  const changes: Record<string, FlowCell | undefined> = {};
  let replacement: string[] = [];
  if (withAnswers) {
    for (const cid of subtreeIds(sheet, id)) changes[cid] = undefined;
  } else {
    changes[id] = undefined;
    replacement = cell.kids;
    for (const kid of cell.kids) changes[kid] = { ...sheet.cells[kid], parent: cell.parent };
  }
  const swap = (list: string[]) => {
    const out = [...list];
    const at = out.indexOf(id);
    if (at >= 0) out.splice(at, 1, ...replacement);
    return out;
  };
  if (cell.parent) {
    const parent = sheet.cells[cell.parent];
    changes[parent.id] = { ...parent, kids: swap(parent.kids) };
    return withCells(sheet, changes);
  }
  return withCells(sheet, changes, swap(sheet.roots));
}

/** Move a cell up (-1) or down (+1) among the cells attached to the same argument. */
/**
 * Go back (or forward again) to another version of the sheet's STRUCTURE
 * without throwing away typing.
 *
 * Undo steps back over adds, deletes, moves and marks. Typing is not one of
 * those steps, so the words in every cell that exists in both versions stay as
 * they are now. A cell that only exists in the target version comes back with
 * the words it had then.
 */
export function restoreStructure(target: FlowSheet, current: FlowSheet): FlowSheet {
  const cells: Record<string, FlowCell> = {};
  for (const [id, cell] of Object.entries(target.cells)) {
    const now = current.cells[id];
    cells[id] = now && now.text !== cell.text ? { ...cell, text: now.text } : cell;
  }
  return { ...target, name: current.name, cells };
}

export function moveCell(sheet: FlowSheet, id: string, dir: -1 | 1): FlowSheet {
  const cell = sheet.cells[id];
  if (!cell) return sheet;
  const list = [...siblingsOf(sheet, cell)];
  const at = list.indexOf(id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) return sheet;
  [list[at], list[to]] = [list[to], list[at]];
  if (cell.parent) return withCells(sheet, { [cell.parent]: { ...sheet.cells[cell.parent], kids: list } });
  return withCells(sheet, {}, list);
}

/** The columns a cell is allowed to sit in: after its parent, before its own answers. */
export function allowedColumns(sheet: FlowSheet, id: string): { min: number; max: number } {
  const cell = sheet.cells[id];
  const parentCol = cell.parent ? sheet.cells[cell.parent].col : -1;
  let max = sheet.columns.length - 1;
  for (const kid of cell.kids) max = Math.min(max, sheet.cells[kid].col - 1);
  return { min: parentCol + 1, max };
}

/** Slide a cell one column left (-1) or right (+1), e.g. from the 2NC to the 1NR. */
export function shiftColumn(sheet: FlowSheet, id: string, dir: -1 | 1): FlowSheet {
  const cell = sheet.cells[id];
  if (!cell) return sheet;
  const { min, max } = allowedColumns(sheet, id);
  const col = cell.col + dir;
  if (col < min || col > max) return sheet;
  return withCells(sheet, { [id]: { ...cell, col } });
}

/**
 * Attach a cell (and everything below it) to a different argument, or to
 * nothing (`null`, making it a top-level argument).
 * Returns an error message instead of a sheet when the link is impossible.
 */
export function reparent(sheet: FlowSheet, id: string, newParentId: string | null): FlowSheet | { error: string } {
  const cell = sheet.cells[id];
  if (!cell) return { error: 'That cell no longer exists.' };
  if (newParentId === cell.parent) return sheet;
  if (newParentId) {
    const target = sheet.cells[newParentId];
    if (!target) return { error: 'That cell no longer exists.' };
    if (subtreeIds(sheet, id).includes(newParentId)) return { error: 'A cell cannot answer itself or one of its own answers.' };
    if (target.col >= cell.col) return { error: 'An answer must be in a later speech than the argument it answers.' };
  }
  const changes: Record<string, FlowCell | undefined> = { [id]: { ...cell, parent: newParentId } };
  let roots = sheet.roots;
  // Unhook from the old place.
  if (cell.parent) {
    const old = sheet.cells[cell.parent];
    changes[old.id] = { ...old, kids: old.kids.filter((k) => k !== id) };
  } else {
    roots = roots.filter((r) => r !== id);
  }
  // Hook onto the new place.
  if (newParentId) {
    const target = (changes[newParentId] as FlowCell | undefined) ?? sheet.cells[newParentId];
    changes[newParentId] = { ...target, kids: [...target.kids, id] };
  } else {
    roots = [...roots, id];
  }
  return withCells(sheet, changes, roots);
}

// ---------------------------------------------------------------------------
// Layout: where each cell goes on screen
// ---------------------------------------------------------------------------

export interface CellPosition {
  /** First row (0-based). */
  row: number;
  /** How many rows tall: an argument with three answers is three rows tall. */
  span: number;
}

export interface FlowLayout {
  rows: number;
  pos: Record<string, CellPosition>;
}

export function layoutSheet(sheet: FlowSheet): FlowLayout {
  const pos: Record<string, CellPosition> = {};
  const seen = new Set<string>();
  const place = (id: string, row: number): number => {
    const cell = sheet.cells[id];
    if (!cell || seen.has(id)) return 0; // damaged data: skip rather than loop forever
    seen.add(id);
    let used = 0;
    for (const kid of cell.kids) used += place(kid, row + used);
    const span = Math.max(1, used);
    pos[id] = { row, span };
    return span;
  };
  let rows = 0;
  for (const root of sheet.roots) rows += place(root, rows);
  return { rows, pos };
}

/** Cells of one column, top to bottom (used for Up/Down arrow keys). */
export function columnOrder(sheet: FlowSheet, layout: FlowLayout, col: number): string[] {
  return Object.values(sheet.cells)
    .filter((c) => c.col === col && layout.pos[c.id])
    .sort((a, b) => layout.pos[a.id].row - layout.pos[b.id].row)
    .map((c) => c.id);
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Which cell do you land on when you press an arrow key? Null = stay put. */
export function neighbour(sheet: FlowSheet, layout: FlowLayout, id: string, dir: Direction): string | null {
  const cell = sheet.cells[id];
  const here = layout.pos[id];
  if (!cell || !here) return null;
  if (dir === 'up' || dir === 'down') {
    const order = columnOrder(sheet, layout, cell.col);
    const at = order.indexOf(id);
    return order[at + (dir === 'up' ? -1 : 1)] ?? null;
  }
  if (dir === 'left' && cell.parent) return cell.parent;
  if (dir === 'right' && cell.kids.length) {
    // The answer in the nearest column; ties go to the top one.
    return [...cell.kids].sort((a, b) => sheet.cells[a].col - sheet.cells[b].col || layout.pos[a].row - layout.pos[b].row)[0];
  }
  // No parent / no answers: step to the nearest cell in the next used column at about the same height.
  const step = dir === 'left' ? -1 : 1;
  for (let col = cell.col + step; col >= 0 && col < sheet.columns.length; col += step) {
    const order = columnOrder(sheet, layout, col);
    if (!order.length) continue;
    let best = order[0];
    let bestGap = Infinity;
    for (const cid of order) {
      const p = layout.pos[cid];
      const gap = here.row < p.row ? p.row - here.row : here.row >= p.row + p.span ? here.row - (p.row + p.span - 1) : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = cid;
      }
    }
    return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dropped arguments
// ---------------------------------------------------------------------------

export type DropStatus =
  /** You marked it dropped. */
  | 'dropped'
  /** The other team's chance to answer has passed and nothing is attached: probably dropped. */
  | 'maybe-dropped'
  /** Answered, or it is too early to say, or you said it is fine. */
  | 'ok';

/**
 * The columns in which the other team gets its next chance to answer a cell.
 * For a 2AC argument that is the whole negative block (2NC and 1NR).
 */
export function answerWindow(sheet: FlowSheet, col: number): number[] {
  const side = columnSide(sheet.columns[col]);
  const out: number[] = [];
  for (let i = col + 1; i < sheet.columns.length; i++) {
    const other = columnSide(sheet.columns[i]) !== side;
    if (other) out.push(i);
    else if (out.length) break; // our own side speaks again: the window is over
  }
  return out;
}

/**
 * How far has the round got? Returns the index (in SPEECHES order) of the
 * latest speech that has anything written in it, across all the given sheets.
 * -1 when everything is empty.
 */
export function latestSpeechFlowed(sheets: FlowSheet[]): number {
  let latest = -1;
  for (const sheet of sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (!cell.text.trim()) continue;
      const col = sheet.columns[cell.col];
      // A merged block column counts as "the block has started" (2NC).
      const idx = col === 'BLOCK' ? SPEECHES.indexOf('2NC') : SPEECHES.indexOf(col);
      if (idx > latest) latest = idx;
    }
  }
  return latest;
}

function speechIndexOfColumn(col: ColumnId): number {
  return col === 'BLOCK' ? SPEECHES.indexOf('1NR') : SPEECHES.indexOf(col);
}

/**
 * Is this argument dropped?
 * @param reachedSpeech index in SPEECHES of the latest speech that has started (see latestSpeechFlowed)
 */
export function dropStatus(sheet: FlowSheet, id: string, reachedSpeech: number): DropStatus {
  const cell = sheet.cells[id];
  if (!cell) return 'ok';
  if (cell.dropped === true) return 'dropped';
  if (cell.dropped === false || !cell.text.trim()) return 'ok';
  const side = columnSide(sheet.columns[cell.col]);
  const answered = cell.kids.some((k) => {
    const kid = sheet.cells[k];
    return kid && kid.text.trim() !== '' && columnSide(sheet.columns[kid.col]) !== side;
  });
  if (answered) return 'ok';
  const window = answerWindow(sheet, cell.col);
  if (!window.length) return 'ok'; // nothing comes after the 2AR
  // The other team's chance has passed once a speech AFTER their window has begun.
  const lastChance = speechIndexOfColumn(sheet.columns[window[window.length - 1]]);
  return reachedSpeech > lastChance ? 'maybe-dropped' : 'ok';
}

// ---------------------------------------------------------------------------
// Safety net for loading saved flows
// ---------------------------------------------------------------------------

/**
 * Check a sheet that was loaded from disk and fix anything broken, so a
 * damaged save can never crash the flow or hide cells. Fixes: links to cells
 * that do not exist, cells nobody links to, loops, and out-of-range columns.
 */
export function repairSheet(input: FlowSheet): FlowSheet {
  const columns = Array.isArray(input.columns) && input.columns.length ? input.columns : buildColumns('1AC', false);
  const cells: Record<string, FlowCell> = {};
  for (const [id, raw] of Object.entries(input.cells ?? {})) {
    if (!raw || typeof raw !== 'object') continue;
    cells[id] = {
      ...raw,
      id,
      text: typeof raw.text === 'string' ? raw.text : '',
      col: Math.min(columns.length - 1, Math.max(0, Number.isFinite(raw.col) ? Math.floor(raw.col) : 0)),
      parent: typeof raw.parent === 'string' ? raw.parent : null,
      kids: Array.isArray(raw.kids) ? raw.kids.filter((k) => typeof k === 'string') : [],
    };
  }
  const placed = new Set<string>();
  const roots: string[] = [];
  // Walk down from the roots, keeping only links that make sense.
  const visit = (id: string, parent: string | null) => {
    const cell = cells[id];
    placed.add(id);
    cell.parent = parent;
    const kids: string[] = [];
    for (const k of cell.kids) {
      // Skip links to missing cells, repeats, and anything already placed (that would be a loop).
      if (!cells[k] || placed.has(k) || kids.includes(k)) continue;
      if (cells[k].col <= cell.col) {
        // An answer must be in a later column. If there is no later column, leave it
        // out here; it is rescued as a top-level cell below.
        if (cell.col >= columns.length - 1) continue;
        cells[k].col = cell.col + 1;
      }
      kids.push(k);
    }
    cell.kids = kids;
    for (const k of kids) placed.add(k);
    for (const k of kids) visit(k, id);
  };
  for (const r of Array.isArray(input.roots) ? input.roots : []) {
    if (cells[r] && !placed.has(r)) {
      roots.push(r);
      visit(r, null);
    }
  }
  // Anything not reached from a root is an orphan: rescue it as a top-level cell.
  for (const id of Object.keys(cells)) {
    if (!placed.has(id)) {
      roots.push(id);
      visit(id, null);
    }
  }
  return {
    id: typeof input.id === 'string' ? input.id : newId(),
    name: typeof input.name === 'string' ? input.name : 'Sheet',
    kind: input.kind ?? 'other',
    columns,
    roots,
    cells,
  };
}

/** Number of non-empty cells: shown on sheet tabs. */
export function countCells(sheet: FlowSheet): number {
  let n = 0;
  for (const c of Object.values(sheet.cells)) if (c.text.trim()) n++;
  return n;
}

/** Plain-text version of a sheet, for copying into a doc or giving to the AI in Prep. */
export function sheetToText(sheet: FlowSheet): string {
  const lines: string[] = [`## ${sheet.name} (${SHEET_KIND_LABEL[sheet.kind]})`];
  const walk = (id: string, depth: number) => {
    const cell = sheet.cells[id];
    if (!cell) return;
    const flags = [cell.dropped === true ? 'DROPPED' : '', cell.turn ? 'TURN' : '', isExtension(sheet, cell) ? 'extension' : '']
      .filter(Boolean)
      .join(', ');
    const text = cell.text.trim().replace(/\s*\n\s*/g, ' / ') || '(blank)';
    lines.push(`${'  '.repeat(depth)}- [${columnLabel(sheet.columns[cell.col])}] ${text}${flags ? ` {${flags}}` : ''}`);
    cell.kids.forEach((k) => walk(k, depth + 1));
  };
  sheet.roots.forEach((r) => walk(r, 0));
  return lines.join('\n');
}
