// ROUND MODE
// ==========
// What you see during a round: the flow, the timers, your CX notes, and (from
// the library) your own prepared files. Nothing in this folder imports the AI
// client. A test (tests/unit/lockout.test.ts) fails the build if that ever changes.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { lockState } from '../../ai/lock';
import { now } from '../../core/ids';
import { ROUND_STEPS, SPEECHES, type SpeechId } from '../../core/debate/formats';
import {
  countCells,
  createSheet,
  latestSpeechFlowed,
  SHEET_KIND_LABEL,
  type FlowSheet,
  type SheetKind,
} from '../../core/flow/model';
import type { RoundClock } from '../../core/timer/timer';
import { db, saveState, settings } from '../../data/store';
import type { Round } from '../../data/schema';
import { confirmDialog, Kbd, openDialog, Segmented, TextArea, TextInput, toast } from '../../ui/kit';
import { navigate } from '../../app/router';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { FlowView } from './FlowView';
import { TimerBar } from './TimerBar';
import { endRound } from './roundService';
import { RoundDocs } from './RoundDocs';

type Tab = 'flow' | 'docs' | 'cx';

const QUICK_SHEETS: { kind: SheetKind; label: string }[] = [
  { kind: 'da', label: 'DA' },
  { kind: 'cp', label: 'CP' },
  { kind: 'k', label: 'K' },
  { kind: 't', label: 'T' },
  { kind: 'case', label: 'Case' },
  { kind: 'theory', label: 'Theory' },
];

/** The banner that is always on screen during a round. */
function LockBanner({ round, onEnd }: { round: Round | undefined; onEnd: () => void }) {
  const s = saveState.value;
  return (
    <header class="lock-banner" role="banner">
      <strong class="lock-title">
        <span class="lock-dot" aria-hidden="true" /> Round Mode — AI off
      </strong>
      <span class="lock-round">
        {round ? round.name : 'Round'}
        {round?.practice ? ' (practice)' : ''}
      </span>
      <span class={`save-pill ${s.error ? 'is-error' : ''}`} role="status">
        {s.error ? s.error : s.pending ? 'Saving…' : 'Saved'}
      </span>
      <button class="btn btn-end" onClick={onEnd}>
        End round
      </button>
    </header>
  );
}

function askSheetName(kind: SheetKind, suggested: string): Promise<string | undefined> {
  return openDialog<string>((close) => {
    const Body = () => {
      const [name, setName] = useState(suggested);
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(name.trim() || suggested);
          }}
        >
          <h2 class="dialog-title">New {SHEET_KIND_LABEL[kind].toLowerCase()} sheet</h2>
          <div class="dialog-body">
            <TextInput value={name} onChange={setName} aria-label="Sheet name" autofocus onFocus={(e: FocusEvent) => (e.target as HTMLInputElement).select()} />
            <p class="field-hint">Name it after the argument, e.g. "Econ DA" or "States CP". Press Enter to add.</p>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn" onClick={() => close()}>
              Cancel
            </button>
            <button type="submit" class="btn btn-primary">
              Add sheet
            </button>
          </div>
        </form>
      );
    };
    return <Body />;
  });
}

function ShortcutHelp({ close }: { close: () => void }) {
  const rows: [string, string][] = [
    ['Enter', 'New cell below'],
    ['Tab', 'Answer this argument (or go to its first answer)'],
    ['Alt+E', 'Extend this argument'],
    ['Shift+Tab', 'Back to the argument being answered'],
    ['Arrow keys', 'Move between cells (from the edge of the text)'],
    ['Alt+← / Alt+→', 'Move left / right from anywhere in the text'],
    ['Shift+Enter', 'Line break inside a cell'],
    ['Ctrl+Enter', 'New top-level argument in this column'],
    ['Ctrl+D', 'Mark or unmark as dropped'],
    ['Alt+T', 'Mark or unmark as a turn'],
    ['Alt+↑ / Alt+↓', 'Move the cell up or down'],
    ['Alt+Shift+← / →', 'Slide the cell to the next speech (2NC ↔ 1NR)'],
    ['Ctrl+L', 'Re-link an answer to a different argument'],
    ['Ctrl+U', 'Unlink (make it a top-level argument)'],
    ['Backspace', 'Delete an empty cell'],
    ['Ctrl+Shift+Backspace', 'Delete a cell and everything attached to it'],
    ['Alt+Z', 'Undo the last add, delete, move or mark (your typing is kept)'],
    ['Alt+Shift+Z', 'Redo'],
    ['Esc', 'Leave the flow grid (then Tab moves between buttons again)'],
    ['Alt+1 … Alt+9', 'Switch sheet'],
    ['Alt+[ / Alt+]', 'Previous / next sheet'],
    ['Alt+S', 'Start or stop the speech timer'],
    ['Alt+A / Alt+N', 'Start or stop Aff / Neg prep'],
    ['Alt+. / Alt+,', 'Next / previous speech'],
    ['Alt+R', 'Reset the speech timer'],
    ['Alt+B', 'Big timer on or off'],
    ['Alt+F / Alt+X / Alt+O', 'Flow / CX notes / Docs'],
    ['Alt+/', 'This list'],
  ];
  return (
    <>
      <h2 class="dialog-title">Keyboard shortcuts</h2>
      <div class="dialog-body shortcut-list">
        {rows.map(([k, what]) => (
          <div key={k} class="shortcut-row">
            <span>
              <Kbd>{k}</Kbd>
            </span>
            <span>{what}</span>
          </div>
        ))}
        <p class="field-hint">On a Mac, Alt is the Option key and Ctrl can also be Command.</p>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-primary" autofocus onClick={close}>
          Close
        </button>
      </div>
    </>
  );
}

export function RoundMode() {
  const roundId = lockState.value?.roundId ?? null;
  // Subscribe to the rounds list so this screen re-draws when the round is saved.
  const round = db.rounds.list.value.find((r) => r.id === roundId);
  const [tab, setTab] = useState<Tab>('flow');
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const roundRef = useRef(round);
  roundRef.current = round;

  /** Change the round and save it. Typing is saved after a short pause; everything else at once. */
  const save = useCallback((change: (r: Round) => Round, delayMs = 0) => {
    const cur = roundRef.current;
    if (!cur) return;
    const next = change(cur);
    roundRef.current = next;
    db.rounds.put(next, delayMs);
  }, []);

  const onClock = useCallback((clock: RoundClock) => save((r) => ({ ...r, clock })), [save]);
  const toggleBig = useCallback(() => setBig((b) => !b), []);

  const sheets = round?.sheets ?? [];
  const sheet = sheets.find((s) => s.id === sheetId) ?? sheets[0];

  const onSheet = useCallback(
    (next: FlowSheet) => save((r) => ({ ...r, sheets: r.sheets.map((s) => (s.id === next.id ? next : s)) }), 250),
    [save],
  );

  const addSheet = async (kind: SheetKind) => {
    const r = roundRef.current;
    if (!r) return;
    const count = r.sheets.filter((s) => s.kind === kind).length;
    const base = kind === 'case' ? 'Case' : SHEET_KIND_LABEL[kind];
    const suggested = kind === 't' && count === 0 ? 'T' : `${kind === 'da' ? 'DA' : kind === 'cp' ? 'CP' : kind === 'k' ? 'K' : base}${count ? ` ${count + 1}` : ''}`;
    const name = await askSheetName(kind, suggested);
    if (name === undefined) return;
    const fresh = createSheet(name, kind, r.mergeBlock);
    save((cur) => ({ ...cur, sheets: [...cur.sheets, fresh] }));
    setSheetId(fresh.id);
    setTab('flow');
  };

  const renameSheet = async (s: FlowSheet) => {
    const name = await askSheetName(s.kind, s.name);
    if (name !== undefined) save((cur) => ({ ...cur, sheets: cur.sheets.map((x) => (x.id === s.id ? { ...x, name } : x)) }));
  };

  const deleteSheet = async (s: FlowSheet) => {
    const n = countCells(s);
    if (n > 0) {
      const yes = await confirmDialog({
        title: `Delete the "${s.name}" sheet?`,
        body: `It has ${n} filled-in cell${n === 1 ? '' : 's'}. This cannot be undone.`,
        confirm: 'Delete sheet',
        danger: true,
      });
      if (!yes) return;
    }
    save((cur) => ({ ...cur, sheets: cur.sheets.filter((x) => x.id !== s.id) }));
    setSheetId(null);
  };

  const moveSheet = (s: FlowSheet, dir: -1 | 1) =>
    save((cur) => {
      const list = [...cur.sheets];
      const at = list.findIndex((x) => x.id === s.id);
      const to = at + dir;
      if (at < 0 || to < 0 || to >= list.length) return cur;
      [list[at], list[to]] = [list[to], list[at]];
      return { ...cur, sheets: list };
    });

  const doEnd = async () => {
    const yes = await confirmDialog({
      title: 'End the round?',
      body: (
        <>
          <p>This stops the timers, saves the flow, and turns AI back on.</p>
          <p>
            <strong>Only do this when the round is really over.</strong> The flow moves to Prep for review.
          </p>
        </>
      ),
      confirm: 'End round',
      cancel: 'Keep debating',
      danger: true,
    });
    if (!yes) return;
    const id = await endRound();
    navigate(id ? `/rounds/${id}` : '/home');
    toast('Round ended. You are back in Prep.', { kind: 'success' });
  };

  // Shortcuts that work anywhere in Round Mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const list = roundRef.current?.sheets ?? [];
      const digit = /^Digit([1-9])$/.exec(e.code);
      let handled = true;
      if (digit) {
        const target = list[Number(digit[1]) - 1];
        if (target) {
          setSheetId(target.id);
          setTab('flow');
        }
      } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        setSheetId((cur) => {
          const at = Math.max(0, list.findIndex((s) => s.id === cur));
          const to = (at + (e.code === 'BracketLeft' ? -1 : 1) + list.length) % Math.max(1, list.length);
          return list[to]?.id ?? cur;
        });
        setTab('flow');
      } else if (e.code === 'KeyF') setTab('flow');
      else if (e.code === 'KeyX') setTab('cx');
      else if (e.code === 'KeyO') setTab('docs');
      else if (e.code === 'Slash') void openDialog((close) => <ShortcutHelp close={() => close()} />);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The round's data is gone (deleted or damaged). Stay locked, but offer the way out.
  if (!round) {
    return (
      <div class="round">
        <LockBanner round={undefined} onEnd={doEnd} />
        <div class="round-missing">
          <h1>This round's data could not be found.</h1>
          <p>Round Mode is still on, so AI stays off. End the round to go back to Prep.</p>
          <button class="btn btn-primary" onClick={doEnd}>
            End round
          </button>
        </div>
      </div>
    );
  }

  // How far the round has got: the later of "what the timer says" and "what has been flowed".
  const clockSpeech = SPEECHES.indexOf(ROUND_STEPS[round.clock.stepIndex].speech as SpeechId);
  const reached = Math.max(latestSpeechFlowed(sheets), round.clock.speech.running || round.clock.stepIndex > 0 ? clockSpeech : -1);
  const flowPrefs = settings.value.flow;

  return (
    <div class={`round ${big ? 'has-big-timer' : ''}`}>
      <LockBanner round={round} onEnd={doEnd} />
      <TimerBar clock={round.clock} format={round.format} onChange={onClock} big={big} onToggleBig={toggleBig} />
      {!big && (
        <>
          <nav class="round-tabs" aria-label="Round Mode sections">
            <Segmented<Tab>
              ariaLabel="Section"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'flow', label: 'Flow' },
                { value: 'docs', label: 'Docs' },
                { value: 'cx', label: 'CX notes' },
              ]}
            />
            {tab === 'flow' && (
              <div class="sheet-tabs" role="tablist" aria-label="Flow sheets">
                {sheets.map((s, i) => (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={s.id === sheet?.id}
                    class={`sheet-tab kind-${s.kind} ${s.id === sheet?.id ? 'is-on' : ''}`}
                    onClick={() => setSheetId(s.id)}
                    title={`${SHEET_KIND_LABEL[s.kind]} sheet (Alt+${i + 1})`}
                  >
                    {s.name}
                    <span class="sheet-count">{countCells(s) || ''}</span>
                  </button>
                ))}
                <span class="sheet-add">
                  {QUICK_SHEETS.map((q) => (
                    <button key={q.kind} class="chip-btn" onClick={() => addSheet(q.kind)} title={`Add a ${SHEET_KIND_LABEL[q.kind].toLowerCase()} sheet`}>
                      + {q.label}
                    </button>
                  ))}
                </span>
              </div>
            )}
            <button class="btn btn-quiet help-btn" onClick={() => openDialog((close) => <ShortcutHelp close={() => close()} />)} title="Keyboard shortcuts (Alt+/)">
              Keys
            </button>
          </nav>
          <main class="round-main">
            {/* If one tab cannot be drawn, the banner, the timers and the other tabs keep working. */}
            <ErrorBoundary key={`${tab}:${sheet?.id ?? ''}`} what={tab === 'flow' ? 'the flow' : tab === 'cx' ? 'the CX notes' : 'your files'}>
            {tab === 'flow' && sheet && (
              <>
                <div class="sheet-tools">
                  <span class="sheet-title">
                    {sheet.name}
                    {sheet.name.toLowerCase() !== SHEET_KIND_LABEL[sheet.kind].toLowerCase() && <span class="muted"> · {SHEET_KIND_LABEL[sheet.kind]}</span>}
                  </span>
                  <button class="btn btn-quiet" onClick={() => renameSheet(sheet)}>
                    Rename
                  </button>
                  <button class="btn btn-quiet" onClick={() => moveSheet(sheet, -1)} aria-label="Move sheet left">
                    ←
                  </button>
                  <button class="btn btn-quiet" onClick={() => moveSheet(sheet, 1)} aria-label="Move sheet right">
                    →
                  </button>
                  <button class="btn btn-quiet" onClick={() => deleteSheet(sheet)} disabled={sheets.length <= 1}>
                    Delete sheet
                  </button>
                </div>
                <FlowView
                  key={sheet.id}
                  sheet={sheet}
                  onChange={onSheet}
                  reachedSpeech={reached}
                  abbreviations={flowPrefs.abbreviations}
                  dropHints={flowPrefs.dropHints}
                  fontPx={flowPrefs.fontPx}
                />
              </>
            )}
            {tab === 'cx' && (
              <>
                <ScoutNotes round={round} />
                <CxNotes round={round} onChange={(cxNotes) => save((r) => ({ ...r, cxNotes }), 250)} />
              </>
            )}
            {tab === 'docs' && <RoundDocs round={round} onFills={(fills) => save((r) => ({ ...r, fills }), 250)} />}
            </ErrorBoundary>
          </main>
        </>
      )}
    </div>
  );
}

/** Your own scouting notes for this round's opponent and judge, read-only. Nothing is generated. */
function ScoutNotes({ round }: { round: Round }) {
  const has = (hay: string, needle: string) => needle.trim().length > 1 && hay.toLowerCase().includes(needle.trim().toLowerCase());
  const hits = db.scouting.list.value.filter((d) =>
    d.type === 'team' ? has(round.meta.opponent, d.school) || has(round.meta.opponent, d.code) : d.type === 'judge' ? has(round.meta.judge, d.name) : false,
  );
  if (!hits.length) return null;
  return (
    <section class="scout-notes" aria-label="Your scouting notes">
      {hits.map((d) =>
        d.type === 'judge' ? (
          <details key={d.id} open>
            <summary>
              <strong>Judge: {d.name}</strong>
            </summary>
            {d.preferences.trim() && <p>{d.preferences}</p>}
            {d.notes.trim() && <p class="muted">{d.notes}</p>}
          </details>
        ) : d.type === 'team' ? (
          <details key={d.id}>
            <summary>
              <strong>
                Opponent: {d.school} {d.code}
              </strong>
            </summary>
            {d.affNotes.trim() && <p>On the aff: {d.affNotes}</p>}
            {d.negNotes.trim() && <p>On the neg: {d.negNotes}</p>}
            {d.notes.trim() && <p class="muted">{d.notes}</p>}
          </details>
        ) : null,
      )}
    </section>
  );
}

/** Manual notes for the four cross-examinations. Typed by you; nothing is generated. */
export function CxNotes({ round, onChange, readOnly }: { round: Round; onChange: (notes: Record<string, string>) => void; readOnly?: boolean }) {
  const periods = ROUND_STEPS.filter((s) => s.kind === 'cx');
  return (
    <div class="cx-notes">
      {periods.map((p) => (
        <section key={p.speech} class={`cx-card side-${p.side}`}>
          <h3>
            {p.label} <span class="muted">· {p.detail}</span>
          </h3>
          <TextArea
            rows={7}
            value={round.cxNotes[p.speech] ?? ''}
            onChange={(v) => onChange({ ...round.cxNotes, [p.speech]: v })}
            placeholder={p.side === round.meta.side ? 'Questions to ask, and what they answered…' : 'What they asked, and what we said…'}
            ariaLabel={`Notes for ${p.label}`}
            disabled={readOnly}
          />
        </section>
      ))}
    </div>
  );
}

// Exported for the "round ended" timestamp in review screens.
export function roundLength(round: Round): string {
  const end = round.endedAt ?? now();
  const mins = Math.max(0, Math.round((end - round.startedAt) / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}
