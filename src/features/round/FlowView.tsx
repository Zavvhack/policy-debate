// The flow grid for one sheet.
//
// Keyboard first: you should never need the mouse while flowing.
//
//   Enter            new cell below (another argument in the same speech)
//   Tab              answer this argument (other team's next speech)
//   Alt+E            extend this argument (same team's next speech)
//   Shift+Tab        back to the argument being answered
//   Arrow keys       move between cells (when the cursor is at the edge of the text)
//   Shift+Enter      line break inside a cell
//   Ctrl+Enter       new top-level argument in this column
//   Ctrl+D           mark / unmark as dropped
//   Alt+T            mark / unmark as a turn
//   Alt+Up/Down      move the cell up or down
//   Alt+Shift+Left/Right  slide the cell to the neighbouring speech (e.g. 2NC <-> 1NR)
//   Ctrl+L           re-link: press on the answer, move to the argument it should answer, press again
//   Ctrl+U           unlink (make it a top-level argument)
//   Backspace        in an empty cell: delete it
//   Alt+Z            undo the last add / delete / move (your typing is kept)
//   Alt+Shift+Z      redo
//   Esc              leave the grid (so Tab works normally again)

import { Component, type CSSProperties } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { expandAtCaret, expandAtEnd, type Abbreviation } from '../../core/flow/abbrev';
import {
  addChild,
  addRoot,
  addSibling,
  columnLabel,
  columnSide,
  dropStatus,
  isExtension,
  layoutSheet,
  moveCell,
  neighbour,
  removeCell,
  reparent,
  restoreStructure,
  shiftColumn,
  updateCell,
  type Direction,
  type DropStatus,
  type FlowCell,
  type FlowSheet,
} from '../../core/flow/model';
import type { Side } from '../../core/debate/formats';
import { confirmDialog, toast } from '../../ui/kit';

interface Props {
  sheet: FlowSheet;
  onChange: (sheet: FlowSheet) => void;
  /** Index of the latest speech that has started (drives the "dropped?" hints). */
  reachedSpeech: number;
  abbreviations: readonly Abbreviation[];
  dropHints: boolean;
  fontPx: number;
  readOnly?: boolean;
}

/** Modern browsers can size a text box to its contents with CSS alone; older ones need a nudge from script. */
const CSS_AUTOSIZE = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

function autosize(el: HTMLTextAreaElement | null): void {
  if (!el || CSS_AUTOSIZE) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

interface CellProps {
  cell: FlowCell;
  side: Side;
  ext: boolean;
  status: DropStatus;
  row: number;
  span: number;
  linkSource: boolean;
  linking: boolean;
  readOnly: boolean;
  fontPx: number;
  /** The speech this cell is in, for screen readers. */
  colLabel: string;
  onInput: (id: string, el: HTMLTextAreaElement, inputType: string) => void;
  onKey: (id: string, e: KeyboardEvent) => void;
  onFocus: (id: string) => void;
  onDismissHint: (id: string) => void;
  onPickLink: (id: string) => void;
}

/**
 * One cell. It is a class with shouldComponentUpdate so that typing in one cell
 * re-draws only that cell, which keeps a 300-cell flow quick on a slow laptop.
 */
class CellView extends Component<CellProps> {
  private el: HTMLTextAreaElement | null = null;

  override shouldComponentUpdate(next: CellProps): boolean {
    const p = this.props;
    return (
      next.cell !== p.cell ||
      next.status !== p.status ||
      next.row !== p.row ||
      next.span !== p.span ||
      next.ext !== p.ext ||
      next.side !== p.side ||
      next.linkSource !== p.linkSource ||
      next.linking !== p.linking ||
      next.readOnly !== p.readOnly ||
      next.fontPx !== p.fontPx
    );
  }

  override componentDidMount(): void {
    autosize(this.el);
  }
  override componentDidUpdate(): void {
    autosize(this.el);
  }

  render() {
    const { cell, side, ext, status, row, span, linkSource, linking, readOnly } = this.props;
    const style: CSSProperties = { gridColumn: `${cell.col + 1}`, gridRow: `${row + 2} / span ${span}` };
    const classes = [
      'fc',
      `side-${side}`,
      ext ? 'is-ext' : '',
      status === 'dropped' ? 'is-dropped' : status === 'maybe-dropped' ? 'is-maybe' : '',
      cell.turn ? 'is-turn' : '',
      linkSource ? 'is-link-source' : '',
      linking && !linkSource ? 'is-link-target' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div class={classes} style={style} onMouseDown={linking ? (e) => (e.preventDefault(), this.props.onPickLink(cell.id)) : undefined}>
        {(ext || cell.turn || status !== 'ok') && (
          <div class="fc-badges">
            {ext && <span class="badge badge-ext" title="Extension: same team carrying its own argument forward">ext</span>}
            {cell.turn && <span class="badge badge-turn">turn</span>}
            {status === 'dropped' && <span class="badge badge-dropped">dropped</span>}
            {status === 'maybe-dropped' && !readOnly && (
              <button
                class="badge badge-maybe"
                title="Nothing answers this. Ctrl+D marks it dropped; click to hide this hint."
                onClick={() => this.props.onDismissHint(cell.id)}
                tabIndex={-1}
              >
                no answer?
              </button>
            )}
            {status === 'maybe-dropped' && readOnly && <span class="badge badge-maybe">no answer?</span>}
          </div>
        )}
        <textarea
          id={`fc-${cell.id}`}
          ref={(el) => {
            this.el = el;
          }}
          class="fc-text"
          rows={1}
          spellcheck={false}
          autocomplete="off"
          readOnly={readOnly}
          aria-label={`${this.props.colLabel} flow cell${ext ? ', extension' : ''}${status === 'dropped' ? ', dropped' : ''}`}
          value={cell.text}
          onInput={(e) => this.props.onInput(cell.id, e.currentTarget, (e as InputEvent).inputType ?? '')}
          onKeyDown={(e) => this.props.onKey(cell.id, e)}
          onFocus={() => this.props.onFocus(cell.id)}
        />
      </div>
    );
  }
}

export function FlowView({ sheet, onChange, reachedSpeech, abbreviations, dropHints, fontPx, readOnly = false }: Props) {
  const layout = useMemo(() => layoutSheet(sheet), [sheet]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Where to put the cursor after the next re-draw.
  const wantFocus = useRef<{ id: string; caret: 'start' | 'end' | number } | null>(null);
  const undoStack = useRef<FlowSheet[]>([]);
  const redoStack = useRef<FlowSheet[]>([]);

  // "Latest value" boxes, so the handlers below can stay the same function between
  // re-draws (which is what lets CellView skip re-drawing untouched cells).
  const live = useRef({ sheet, layout, abbreviations, linkFrom, readOnly, onChange });
  live.current = { sheet, layout, abbreviations, linkFrom, readOnly, onChange };

  // A different sheet: forget cursor, link mode and undo history.
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    setLinkFrom(null);
    setFocusId(null);
  }, [sheet.id]);

  useLayoutEffect(() => {
    const want = wantFocus.current;
    if (!want) return;
    const el = document.getElementById(`fc-${want.id}`) as HTMLTextAreaElement | null;
    if (!el) return;
    wantFocus.current = null;
    el.focus();
    const pos = want.caret === 'start' ? 0 : want.caret === 'end' ? el.value.length : want.caret;
    el.setSelectionRange(pos, pos);
    // Keep the cell on screen without jumping the whole page.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // Older browsers: when the columns change width, re-measure every text box.
  useEffect(() => {
    if (CSS_AUTOSIZE || !gridRef.current || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => gridRef.current?.querySelectorAll<HTMLTextAreaElement>('.fc-text').forEach(autosize));
    });
    ro.observe(gridRef.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  /** Apply a structural change (remembering the old sheet for undo) and move the cursor. */
  const commit = useCallback((next: FlowSheet, focus?: string | null, caret: 'start' | 'end' | number = 'end') => {
    const cur = live.current.sheet;
    if (next !== cur) {
      undoStack.current.push(cur);
      if (undoStack.current.length > 60) undoStack.current.shift();
      redoStack.current = []; // a new change starts a new history
      live.current.onChange(next);
    }
    if (focus) wantFocus.current = { id: focus, caret };
  }, []);

  const focusCell = useCallback((id: string | null, caret: 'start' | 'end' = 'end') => {
    if (!id) return;
    const el = document.getElementById(`fc-${id}`) as HTMLTextAreaElement | null;
    if (!el) return;
    el.focus();
    const pos = caret === 'start' ? 0 : el.value.length;
    el.setSelectionRange(pos, pos);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const onInput = useCallback((id: string, el: HTMLTextAreaElement, inputType: string) => {
    const { sheet: s, abbreviations: abbr, onChange: change } = live.current;
    let text = el.value;
    // Expand an abbreviation only when a character was just typed (not on paste or delete).
    if (inputType === 'insertText' && el.selectionStart === el.selectionEnd) {
      const hit = expandAtCaret(text, el.selectionStart, abbr);
      if (hit) {
        text = hit.text;
        wantFocus.current = { id, caret: hit.caret };
      }
    }
    // Typing does not go on the undo stack: the text box has its own Ctrl+Z.
    change(updateCell(s, id, { text }));
  }, []);

  const finishLink = useCallback(
    (targetId: string) => {
      const { sheet: s, linkFrom: from } = live.current;
      if (!from) return;
      setLinkFrom(null);
      if (from === targetId) return;
      const result = reparent(s, from, targetId);
      if ('error' in result) toast(result.error, { kind: 'error' });
      else commit(result, from);
    },
    [commit],
  );

  const onKey = useCallback(
    (id: string, e: KeyboardEvent) => {
      const { sheet: s, layout: lay, abbreviations: abbr, linkFrom: from, readOnly: ro } = live.current;
      const cell = s.cells[id];
      const el = e.currentTarget as HTMLTextAreaElement;
      if (!cell) return;
      // Typing with an input method (accents, Chinese, Japanese...): its Enter and arrows are not ours.
      if (e.isComposing || e.keyCode === 229) return;
      const mod = e.ctrlKey || e.metaKey;
      const sel0 = el.selectionStart;
      const sel1 = el.selectionEnd;
      const collapsed = sel0 === sel1;
      const firstLine = !el.value.slice(0, sel0).includes('\n');
      const lastLine = !el.value.slice(sel1).includes('\n');
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const move = (dir: Direction, caret: 'start' | 'end' = 'end') => {
        const to = neighbour(s, lay, id, dir);
        if (to) focusCell(to, caret);
        return !!to;
      };

      // --- moving around (also works when the flow is read-only) ---
      if (e.key === 'Escape' && from) return stop(), setLinkFrom(null);
      if (e.key === 'Escape') {
        // The way out of the grid for keyboard users: Tab is used for flowing in here,
        // so Esc hands the focus back to the sheet tabs, where Tab works normally.
        stop();
        const out = document.querySelector<HTMLElement>('.sheet-tab.is-on') ?? document.querySelector<HTMLElement>('.round-tabs button');
        if (out) out.focus();
        else el.blur();
        return;
      }
      if (e.altKey && !e.shiftKey && !mod) {
        if (e.key === 'ArrowLeft') return stop(), void move('left');
        if (e.key === 'ArrowRight') return stop(), void move('right');
      }
      if (!e.altKey && !mod && !e.shiftKey && collapsed) {
        if (e.key === 'ArrowUp' && firstLine) return move('up') ? stop() : undefined;
        if (e.key === 'ArrowDown' && lastLine) return move('down', 'start') ? stop() : undefined;
        if (e.key === 'ArrowLeft' && sel0 === 0) return move('left') ? stop() : undefined;
        if (e.key === 'ArrowRight' && sel0 === el.value.length) return move('right', 'start') ? stop() : undefined;
      }
      if (e.key === 'Tab' && e.shiftKey && !mod) {
        stop();
        if (cell.parent) focusCell(cell.parent);
        return;
      }
      if (ro) {
        if (e.key === 'Tab' && !mod) return stop(), void move('right');
        return;
      }

      // Finishing a cell also expands an abbreviation typed at its very end.
      const expanded = () => {
        const text = expandAtEnd(cell.text, abbr);
        return text === cell.text ? s : updateCell(s, id, { text });
      };

      // --- re-linking ---
      if (mod && e.code === 'KeyL') {
        stop();
        if (from) finishLink(id);
        else {
          setLinkFrom(id);
          toast('Move to the argument this should answer, then press Ctrl+L again (Esc cancels).');
        }
        return;
      }
      if (mod && e.code === 'KeyU') {
        stop();
        const result = reparent(s, id, null);
        if (!('error' in result)) commit(result, id);
        return;
      }

      // --- adding cells ---
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        stop();
        const base = expanded();
        if (mod) {
          // New top-level argument in this column, placed after the argument we are inside.
          let top = base.cells[id];
          while (top.parent) top = base.cells[top.parent];
          const r = addRoot(base, cell.col, top.id);
          return commit(r.sheet, r.id);
        }
        const r = addSibling(base, id);
        if (r) commit(r.sheet, r.id);
        return;
      }
      if (e.key === 'Tab' && !mod) {
        stop();
        const base = expanded();
        // If answers already exist, go to the first one; Enter there adds another.
        if (cell.kids.length) {
          if (base !== s) commit(base);
          return void move('right');
        }
        const r = addChild(base, id, 'answer');
        if (r) commit(r.sheet, r.id);
        else toast('There is no later speech to answer this in.');
        return;
      }
      if (e.altKey && !mod && e.code === 'KeyE') {
        stop();
        const r = addChild(expanded(), id, 'extend');
        if (r) commit(r.sheet, r.id);
        else toast('This team has no later speech to extend this in.');
        return;
      }

      // --- marking ---
      if (mod && e.code === 'KeyD') {
        stop();
        return commit(updateCell(s, id, { dropped: cell.dropped === true ? undefined : true }), id, sel0);
      }
      if (e.altKey && !mod && e.code === 'KeyT') {
        stop();
        return commit(updateCell(s, id, { turn: !cell.turn }), id, sel0);
      }

      // --- moving cells ---
      if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        stop();
        return commit(moveCell(s, id, e.key === 'ArrowUp' ? -1 : 1), id, sel0);
      }
      if (e.altKey && e.shiftKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        stop();
        return commit(shiftColumn(s, id, e.key === 'ArrowLeft' ? -1 : 1), id, sel0);
      }

      // --- deleting ---
      if (e.key === 'Backspace' && el.value === '' && !mod) {
        stop();
        const to = neighbour(s, lay, id, 'up') ?? cell.parent ?? neighbour(s, lay, id, 'down');
        return commit(removeCell(s, id, false), to);
      }
      if (mod && e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete')) {
        stop();
        const to = neighbour(s, lay, id, 'up') ?? cell.parent ?? neighbour(s, lay, id, 'down');
        const go = () => commit(removeCell(live.current.sheet, id, true), to);
        if (!cell.kids.length) return go();
        void confirmDialog({
          title: 'Delete this cell and everything attached to it?',
          body: 'You can undo this with Alt+Z.',
          confirm: 'Delete',
          danger: true,
        }).then((yes) => yes && go());
        return;
      }

      // --- undo ---
      // --- undo and redo ---
      // Undo steps back over adds, deletes, moves and marks. Words typed since then
      // are kept, and redo brings back anything an undo removed, so nothing is ever lost for good.
      if (e.altKey && !mod && e.code === 'KeyZ') {
        stop();
        const from_ = e.shiftKey ? redoStack.current : undoStack.current;
        const to_ = e.shiftKey ? undoStack.current : redoStack.current;
        const target = from_.pop();
        if (target) {
          to_.push(s);
          const next = restoreStructure(target, s);
          live.current.onChange(next);
          if (next.cells[id]) wantFocus.current = { id, caret: 'end' };
        } else toast(e.shiftKey ? 'Nothing to redo on this sheet.' : 'Nothing to undo on this sheet.');
      }
    },
    [commit, finishLink, focusCell],
  );

  const onDismissHint = useCallback(
    (id: string) => commit(updateCell(live.current.sheet, id, { dropped: false })),
    [commit],
  );

  const addRootIn = (col: number) => {
    const r = addRoot(sheet, col, null);
    commit(r.sheet, r.id);
  };

  const cells = Object.values(sheet.cells);
  const hasCells = cells.length > 0;

  return (
    <div class={`flow ${linkFrom ? 'is-linking' : ''}`} style={{ '--flow-font': `${fontPx}px` } as CSSProperties}>
      <div
        class="flow-grid"
        ref={gridRef}
        style={{ gridTemplateColumns: `repeat(${sheet.columns.length}, minmax(9.5rem, 1fr))` }}
        role="group"
        aria-label={`Flow for ${sheet.name}`}
      >
        {sheet.columns.map((col, i) => (
          <div key={col} class={`flow-head side-${columnSide(col)}`} style={{ gridColumn: `${i + 1}`, gridRow: '1' }}>
            <span class="flow-head-label">{columnLabel(col)}</span>
            {!readOnly && (
              <button class="flow-add" onClick={() => addRootIn(i)} title={`New argument in the ${columnLabel(col)}`} aria-label={`New argument in the ${columnLabel(col)}`}>
                +
              </button>
            )}
          </div>
        ))}
        {cells.map((cell) => {
          const pos = layout.pos[cell.id];
          if (!pos) return null;
          const status = dropHints || cell.dropped === true ? dropStatus(sheet, cell.id, reachedSpeech) : 'ok';
          return (
            <CellView
              key={cell.id}
              cell={cell}
              side={columnSide(sheet.columns[cell.col])}
              ext={isExtension(sheet, cell)}
              status={!dropHints && status === 'maybe-dropped' ? 'ok' : status}
              row={pos.row}
              span={pos.span}
              linkSource={linkFrom === cell.id}
              linking={linkFrom !== null}
              readOnly={readOnly}
              fontPx={fontPx}
              colLabel={columnLabel(sheet.columns[cell.col])}
              onInput={onInput}
              onKey={onKey}
              onFocus={setFocusId}
              onDismissHint={onDismissHint}
              onPickLink={finishLink}
            />
          );
        })}
      </div>
      {!hasCells && !readOnly && (
        <div class="flow-empty">
          <p>
            This sheet is empty. Press <kbd class="kbd">+</kbd> under a speech to add the first argument.
          </p>
          <button class="btn btn-primary" onClick={() => addRootIn(0)}>
            Add an argument in the {columnLabel(sheet.columns[0])}
          </button>
        </div>
      )}
      {/* Announce the focused cell's place for screen-reader users. */}
      <div class="sr-only" aria-live="polite">
        {focusId && sheet.cells[focusId] ? `${columnLabel(sheet.columns[sheet.cells[focusId].col])} column` : ''}
      </div>
    </div>
  );
}
