// Rebuttal practice: load the flow of a finished or practice round, get
// strategy feedback, and redo speeches from it.

import { useMemo, useState } from 'preact/hooks';
import { aiRebuttalStrategy } from '../../ai/tasks';
import { formatUsd } from '../../ai/pricing';
import { SPEECH_NAME, SPEECH_SIDE, type SpeechId } from '../../core/debate/formats';
import { countCells, sheetToText } from '../../core/flow/model';
import { activeTopic, db } from '../../data/store';
import type { Drill, Round } from '../../data/schema';
import { navigate } from '../../app/router';
import { Field, Select, toast } from '../../ui/kit';
import { AiButton, AiStatus, AiText, useAi } from '../ai/AiUi';
import { DrillBox, DrillHistory, type DrillSpec } from './DrillBox';

const REDO: { speech: SpeechId; kind: Drill['kind'] }[] = [
  { speech: '1AR', kind: 'rebuttal-1ar' },
  { speech: '2NR', kind: 'rebuttal-2nr' },
  { speech: '2AR', kind: 'rebuttal-2ar' },
];

function flowText(round: Round): string {
  return round.sheets.filter((s) => countCells(s) > 0).map(sheetToText).join('\n\n');
}

export function PracticePage({ roundId }: { roundId?: string }) {
  const ai = useAi();
  const topic = activeTopic();
  const rounds = [...db.rounds.list.value].filter((r) => r.status === 'finished').sort((a, b) => b.startedAt - a.startedAt);
  const round = rounds.find((r) => r.id === roundId);
  const [speech, setSpeech] = useState<SpeechId>('2NR');
  const [strategy, setStrategy] = useState<{ text: string; bad: string[] } | null>(null);
  const [past, setPast] = useState<Drill | undefined>();
  const [attempt, setAttempt] = useState(0);

  const flow = useMemo(() => (round ? flowText(round) : ''), [round]);
  const notes = round ? [round.whatWorked, round.reviewNotes].filter((s) => s.trim()).join('\n') : '';
  const seconds = round ? round.format.rebuttal : 300;

  const spec: DrillSpec | null = round
    ? {
        kind: REDO.find((r) => r.speech === speech)!.kind,
        title: `Redo the ${speech}: ${round.name}`,
        prompt: `Give the ${speech} (${SPEECH_NAME[speech]}) again from this flow, as the ${SPEECH_SIDE[speech] === 'aff' ? 'affirmative' : 'negative'}. Choose what to go for, extend it with warrants, answer their best arguments, and end with impact comparison. ${Math.round(seconds / 60)} minutes.`,
        context: flow,
        roundId: round.id,
        seconds,
      }
    : null;

  const getStrategy = () =>
    ai.run(async (signal) => {
      if (!round) return;
      const out = await aiRebuttalStrategy({ topic, side: round.meta.side, flow, notes, signal });
      setStrategy({ text: out.text, bad: out.badQuotes });
      toast(`Strategy ready (${formatUsd(out.usd)}).`, { kind: 'success' });
    });

  return (
    <div class="page">
      <h1>Rebuttal practice</h1>
      <p class="lead">Pick a round you have flowed. Get feedback on where it stood and what the last rebuttals should have done, then give those speeches again.</p>
      <div class="card form-grid">
        <Field label="Round">
          <Select
            value={round?.id ?? ''}
            onChange={(id) => {
              setStrategy(null);
              setPast(undefined);
              navigate(id ? `/practice/${id}` : '/practice');
            }}
            options={[{ value: '', label: rounds.length ? 'Choose a round…' : 'No finished rounds yet' }, ...rounds.map((r) => ({ value: r.id, label: `${r.name}${r.practice ? ' (practice)' : ''} · ${new Date(r.startedAt).toLocaleDateString()}` }))]}
          />
        </Field>
        {!rounds.length && (
          <p class="muted">
            Flow a round (or a practice round) first: <a class="link" href="#/round/new">start a round</a>. When you end it, its flow appears here.
          </p>
        )}
        {round && (
          <>
            <p class="muted">
              You were {round.meta.side === 'aff' ? 'affirmative' : 'negative'}
              {round.meta.opponent ? ` against ${round.meta.opponent}` : ''}. {round.sheets.length} sheet{round.sheets.length === 1 ? '' : 's'}, {round.sheets.reduce((n, s) => n + countCells(s), 0)} cells flowed.{' '}
              <a class="link" href={`#/rounds/${round.id}`}>
                Open the flow
              </a>
            </p>
            {!flow.trim() ? (
              <div class="notice">This round's flow is empty, so there is nothing to practise from.</div>
            ) : (
              <>
                <details>
                  <summary>The flow as the AI will see it</summary>
                  <pre class="flow-text">{flow}</pre>
                </details>
                <AiButton ai={ai} onRun={getStrategy} tier="strong" promptChars={flow.length + notes.length + 2500} outputTokens={2200} primary>
                  Where did this round stand, and what should the {round.meta.side === 'aff' ? '2AR' : '2NR'} have done?
                </AiButton>
                <AiStatus ai={ai} />
                {strategy && <AiText text={strategy.text} badQuotes={strategy.bad} />}
              </>
            )}
          </>
        )}
      </div>

      {round && spec && flow.trim() && (
        <div class="card form-grid">
          <h2>Redo a speech</h2>
          <Field label="Speech" class="field-small">
            <Select
              value={speech}
              onChange={(s) => {
                setSpeech(s);
                setPast(undefined);
              }}
              options={REDO.map((r) => ({ value: r.speech, label: r.speech }))}
            />
          </Field>
          <DrillBox key={`${round.id}-${speech}-${attempt}-${past?.id ?? ''}`} spec={past ? { ...spec, kind: past.kind, title: past.title, prompt: past.prompt } : spec} existing={past} />
          {past && (
            <button class="btn" onClick={() => (setPast(undefined), setAttempt((a) => a + 1))}>
              Start a fresh attempt
            </button>
          )}
          <DrillHistory kinds={['rebuttal-1ar', 'rebuttal-2nr', 'rebuttal-2ar']} roundId={round.id} onOpen={setPast} />
        </div>
      )}
    </div>
  );
}
