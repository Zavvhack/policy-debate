// The "Start a round" form, and the list of past rounds with their review screen.

import { useState } from 'preact/hooks';
import { isAiLocked } from '../../ai/lock';
import { formatClock } from '../../core/ids';
import { roundSeconds } from '../../core/debate/formats';
import { SHEET_KIND_LABEL, sheetToText } from '../../core/flow/model';
import { db, settings, updateSettings } from '../../data/store';
import type { Round, RoundMeta } from '../../data/schema';
import { navigate } from '../../app/router';
import { confirmDialog, Field, Segmented, Select, TextArea, TextInput, toast, Toggle } from '../../ui/kit';
import { FlowView } from './FlowView';
import { CxNotes, roundLength } from './RoundMode';
import { allFormats, defaultRoundName, startRound } from './roundService';

export function StartRoundPage() {
  const [meta, setMeta] = useState<RoundMeta>({ tournament: '', roundNumber: '', side: 'aff', opponent: '', judge: '', room: '' });
  const [practice, setPractice] = useState(false);
  const [name, setName] = useState('');
  const [formatId, setFormatId] = useState(settings.value.timer.formatId);
  const [mergeBlock, setMergeBlock] = useState(settings.value.flow.mergeBlock);
  const [busy, setBusy] = useState(false);
  const formats = allFormats();
  const format = formats.find((f) => f.id === formatId) ?? formats[0];
  const set = (patch: Partial<RoundMeta>) => setMeta((m) => ({ ...m, ...patch }));

  const go = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      // Remember these choices as the defaults for next time.
      updateSettings((s) => ({ ...s, timer: { ...s.timer, formatId }, flow: { ...s.flow, mergeBlock } }));
      await startRound({ name, meta, practice, formatId, mergeBlock });
    } catch (err) {
      toast(`Could not start the round: ${err instanceof Error ? err.message : err}`, { kind: 'error' });
      setBusy(false);
    }
  };

  return (
    <div class="page page-narrow">
      <h1>Start a round</h1>
      <p class="lead">
        Starting a round switches on <strong>Round Mode</strong>: AI is turned off completely until you end the round.
      </p>
      <form class="card form-grid" onSubmit={go}>
        <Field label="Your side" group>
          <Segmented
            ariaLabel="Your side"
            value={meta.side}
            onChange={(side) => set({ side })}
            options={[
              { value: 'aff', label: 'Affirmative', class: 'seg-aff' },
              { value: 'neg', label: 'Negative', class: 'seg-neg' },
            ]}
          />
        </Field>
        <Field label="Time format" hint={`${format.source ?? 'Your own format.'} Speaking time: ${formatClock(roundSeconds(format) * 1000)}.`}>
          <Select value={formatId} onChange={setFormatId} options={formats.map((f) => ({ value: f.id, label: f.name }))} />
        </Field>
        <div class="row">
          <Field label="Tournament">
            <TextInput value={meta.tournament} onChange={(tournament) => set({ tournament })} disabled={practice} />
          </Field>
          <Field label="Round" class="field-small">
            <TextInput value={meta.roundNumber} onChange={(roundNumber) => set({ roundNumber })} placeholder="3" />
          </Field>
        </div>
        <div class="row">
          <Field label="Opponent">
            <TextInput value={meta.opponent} onChange={(opponent) => set({ opponent })} placeholder="School and team code" list="scout-teams" />
          </Field>
          <Field label="Judge">
            <TextInput value={meta.judge} onChange={(judge) => set({ judge })} list="scout-judges" />
          </Field>
          <Field label="Room" class="field-small">
            <TextInput value={meta.room} onChange={(room) => set({ room })} />
          </Field>
        </div>
        {/* Names from your scouting notes, offered as you type. */}
        <datalist id="scout-teams">
          {db.scouting.list.value.map((d) => (d.type === 'team' ? <option key={d.id} value={[d.school, d.code].filter(Boolean).join(' ')} /> : null))}
        </datalist>
        <datalist id="scout-judges">
          {db.scouting.list.value.map((d) => (d.type === 'judge' ? <option key={d.id} value={d.name} /> : null))}
        </datalist>
        <Field label="Name for this round (optional)" hint="Leave blank to name it from the details above.">
          <TextInput value={name} onChange={setName} placeholder={defaultRoundName(meta, practice)} />
        </Field>
        <Toggle checked={practice} onChange={setPractice} label="This is a practice round" hint="Works exactly like a real round (AI off), but is labelled as practice." />
        <Toggle
          checked={mergeBlock}
          onChange={setMergeBlock}
          label="One column for the negative block"
          hint="Off: the 2NC and 1NR each get a column. On: they share one 'Block' column, like most paper flows."
        />
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-large" disabled={busy}>
            Start round — AI off
          </button>
        </div>
      </form>
    </div>
  );
}

function when(t: number): string {
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function RoundsPage() {
  const rounds = [...db.rounds.list.value].sort((a, b) => b.startedAt - a.startedAt);
  const remove = async (r: Round) => {
    const yes = await confirmDialog({ title: `Delete "${r.name}"?`, body: 'It goes to the trash and can be restored from Settings for 30 days.', confirm: 'Delete', danger: true });
    if (!yes) return;
    db.rounds.remove(r.id, `Round: ${r.name}`);
    toast('Round deleted.');
  };
  return (
    <div class="page">
      <div class="page-head">
        <h1>Rounds</h1>
        <button class="btn btn-primary" onClick={() => navigate('/round/new')}>
          Start a round
        </button>
      </div>
      <p class="lead">Every round you flow is kept here for review and rebuttal practice.</p>
      {!rounds.length && <div class="empty">No rounds yet. Your first flow will appear here when you end a round.</div>}
      <ul class="list">
        {rounds.map((r) => (
          <li key={r.id} class="list-row">
            <button class="list-main" onClick={() => navigate(`/rounds/${r.id}`)}>
              <span class={`pill side-${r.meta.side}`}>{r.meta.side === 'aff' ? 'Aff' : 'Neg'}</span>
              <span class="list-title">{r.name}</span>
              {r.practice && <span class="pill">practice</span>}
              {r.result && <span class={`pill ${r.result === 'win' ? 'pill-good' : 'pill-bad'}`}>{r.result}</span>}
              <span class="muted list-meta">
                {when(r.startedAt)} · {r.sheets.length} sheet{r.sheets.length === 1 ? '' : 's'}
                {r.meta.judge ? ` · Judge: ${r.meta.judge}` : ''}
              </span>
            </button>
            <button class="btn btn-quiet" onClick={() => remove(r)} aria-label={`Delete ${r.name}`}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Post-round review: the saved flow (still editable - they are your notes), plus what worked. */
export function RoundReviewPage({ id }: { id: string }) {
  const round = db.rounds.list.value.find((r) => r.id === id);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [view, setView] = useState<'flow' | 'cx' | 'notes'>('flow');
  if (!round) {
    return (
      <div class="page">
        <h1>Round not found</h1>
        <p class="lead">It may have been deleted.</p>
        <button class="btn" onClick={() => navigate('/rounds')}>
          Back to rounds
        </button>
      </div>
    );
  }
  const sheet = round.sheets.find((s) => s.id === sheetId) ?? round.sheets[0];
  const save = (patch: Partial<Round>, delay = 250) => db.rounds.put({ ...round, ...patch }, delay);
  const copyFlow = async () => {
    const text = round.sheets.map(sheetToText).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Flow copied as text.', { kind: 'success' });
    } catch {
      toast('Copying was blocked by the browser.', { kind: 'error' });
    }
  };
  return (
    <div class="page page-wide">
      <div class="page-head">
        <div>
          <button class="link" onClick={() => navigate('/rounds')}>
            ← Rounds
          </button>
          <h1>{round.name}</h1>
          <p class="muted">
            {round.meta.side === 'aff' ? 'Affirmative' : 'Negative'}
            {round.meta.opponent ? ` vs ${round.meta.opponent}` : ''}
            {round.meta.judge ? ` · Judge: ${round.meta.judge}` : ''} · {when(round.startedAt)} · {roundLength(round)}
            {round.practice ? ' · practice' : ''}
          </p>
        </div>
        <div class="row-tight">
          <button class="btn" onClick={copyFlow}>
            Copy flow as text
          </button>
          {!isAiLocked() && (
            <button class="btn btn-primary" onClick={() => navigate(`/practice/${round.id}`)}>
              Practice rebuttals from this flow
            </button>
          )}
        </div>
      </div>
      <div class="round-tabs">
        <Segmented
          ariaLabel="Review section"
          value={view}
          onChange={setView}
          options={[
            { value: 'flow', label: 'Flow' },
            { value: 'cx', label: 'CX notes' },
            { value: 'notes', label: 'Result & notes' },
          ]}
        />
        {view === 'flow' && (
          <div class="sheet-tabs" role="tablist">
            {round.sheets.map((s) => (
              <button key={s.id} role="tab" aria-selected={s.id === sheet?.id} class={`sheet-tab kind-${s.kind} ${s.id === sheet?.id ? 'is-on' : ''}`} onClick={() => setSheetId(s.id)} title={SHEET_KIND_LABEL[s.kind]}>
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {view === 'flow' && sheet && (
        <FlowView
          key={sheet.id}
          sheet={sheet}
          onChange={(next) => save({ sheets: round.sheets.map((s) => (s.id === next.id ? next : s)) })}
          reachedSpeech={8}
          abbreviations={settings.value.flow.abbreviations}
          dropHints={settings.value.flow.dropHints}
          fontPx={settings.value.flow.fontPx}
        />
      )}
      {view === 'cx' && <CxNotes round={round} onChange={(cxNotes) => save({ cxNotes })} />}
      {view === 'notes' && (
        <div class="card form-grid">
          <Field label="Result" group>
            <Segmented
              ariaLabel="Result"
              value={round.result}
              onChange={(result) => save({ result }, 0)}
              options={[
                { value: '', label: 'Not recorded' },
                { value: 'win', label: 'Win' },
                { value: 'loss', label: 'Loss' },
              ]}
            />
          </Field>
          <Field label="What worked" hint="Arguments, framing, or strategy worth repeating against this team or in front of this judge.">
            <TextArea rows={5} value={round.whatWorked} onChange={(whatWorked) => save({ whatWorked })} />
          </Field>
          <Field label="Notes (RFD, things to fix, cards to cut)">
            <TextArea rows={8} value={round.reviewNotes} onChange={(reviewNotes) => save({ reviewNotes })} />
          </Field>
        </div>
      )}
    </div>
  );
}
