// A practice speech: an assignment, a timer, a box to type the speech in, and
// (in Prep only) AI feedback. Used for topicality drills and rebuttal redos.

import { useEffect, useRef, useState } from 'preact/hooks';
import { aiDrillFeedback } from '../../ai/tasks';
import { formatUsd } from '../../ai/pricing';
import { formatClock, newId, now } from '../../core/ids';
import { activeTopic, db } from '../../data/store';
import type { Drill } from '../../data/schema';
import { TextArea, toast } from '../../ui/kit';
import { AiButton, AiStatus, AiText, useAi } from '../ai/AiUi';
import { unverifiedQuotes } from '../../core/ai/quotes';

export interface DrillSpec {
  kind: Drill['kind'];
  title: string;
  /** What the debater is asked to do. */
  prompt: string;
  /** What they are working from (a T file, a flow): shown to the AI for feedback. */
  context: string;
  roundId?: string;
  /** Speech length in seconds. */
  seconds: number;
}

export function DrillBox({ spec, existing }: { spec: DrillSpec; existing?: Drill }) {
  const ai = useAi();
  const [drill, setDrill] = useState<Drill | undefined>(existing);
  const [text, setText] = useState(existing?.response ?? '');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(existing?.seconds ?? 0);
  const base = useRef(existing?.seconds ?? 0);

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setElapsed(base.current + Math.floor((now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const toggleTimer = () => {
    if (startedAt === null) setStartedAt(now());
    else {
      base.current = base.current + Math.floor((now() - startedAt) / 1000);
      setElapsed(base.current);
      setStartedAt(null);
    }
  };

  /** Save the attempt (creating the record the first time). */
  const persist = (patch: Partial<Drill>): Drill => {
    const t = now();
    const next: Drill = {
      ...(drill ?? { id: newId(), createdAt: t, updatedAt: t, topicId: activeTopic()?.id ?? '', kind: spec.kind, title: spec.title, prompt: spec.prompt, roundId: spec.roundId ?? '', response: '', feedback: '', seconds: 0 }),
      response: text,
      seconds: elapsed,
      ...patch,
    };
    const saved = db.drills.put(next);
    setDrill(saved);
    return saved;
  };

  const feedback = () =>
    ai.run(async (signal) => {
      if (startedAt !== null) toggleTimer();
      persist({});
      const out = await aiDrillFeedback({ topic: activeTopic(), drill: spec.title, prompt: spec.prompt, speech: text, context: spec.context, signal });
      persist({ feedback: out.text });
      toast(`Feedback ready (${formatUsd(out.usd)}).`, { kind: 'success' });
    });

  const left = spec.seconds - elapsed;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div class="drill form-grid">
      <div class="drill-prompt">
        <strong>{spec.title}</strong>
        <p>{spec.prompt}</p>
      </div>
      <div class="row-tight">
        <span class={`drill-clock ${left <= 0 ? 'is-over' : left <= 30 ? 'is-warning' : ''}`} role="timer">
          {formatClock(left * 1000)}
        </span>
        <button class="btn" onClick={toggleTimer}>
          {startedAt === null ? (elapsed ? 'Resume' : 'Start the clock') : 'Pause'}
        </button>
        <button
          class="btn btn-quiet"
          onClick={() => {
            base.current = 0;
            setElapsed(0);
            setStartedAt(null);
          }}
        >
          Reset
        </button>
        <span class="muted">
          {words} words{elapsed > 20 && words ? ` · ${Math.round(words / (elapsed / 60))} a minute` : ''}
        </span>
      </div>
      <TextArea
        rows={12}
        value={text}
        onChange={(v) => {
          setText(v);
          if (drill) db.drills.put({ ...drill, response: v, seconds: elapsed }, 400);
        }}
        placeholder="Type the speech as you would give it: the actual words, line by line."
        ariaLabel="Your speech"
      />
      <div class="row-tight">
        <button class="btn" onClick={() => (persist({}), toast('Saved.', { kind: 'success' }))} disabled={!text.trim()}>
          Save this attempt
        </button>
        <AiButton ai={ai} onRun={feedback} tier="strong" promptChars={text.length + spec.context.length + spec.prompt.length + 1200} outputTokens={1200} disabled={text.trim().length < 40} primary>
          Get feedback
        </AiButton>
      </div>
      <AiStatus ai={ai} />
      {drill?.feedback && <AiText text={drill.feedback} badQuotes={unverifiedQuotes(drill.feedback, [text, spec.context, spec.prompt])} />}
    </div>
  );
}

/** Earlier attempts at drills, newest first. */
export function DrillHistory({ kinds, roundId, onOpen }: { kinds: Drill['kind'][]; roundId?: string; onOpen: (d: Drill) => void }) {
  const topicId = activeTopic()?.id;
  const list = db.drills.list.value
    .filter((d) => d.topicId === topicId && kinds.includes(d.kind) && (!roundId || d.roundId === roundId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
  if (!list.length) return null;
  return (
    <section>
      <h3>Earlier attempts</h3>
      <ul class="list">
        {list.map((d) => (
          <li key={d.id} class="list-row">
            <button class="list-main" onClick={() => onOpen(d)}>
              <span class="list-title">{d.title}</span>
              <span class="muted list-meta">
                {new Date(d.createdAt).toLocaleDateString()} · {d.response.trim().split(/\s+/).filter(Boolean).length} words · {formatClock(d.seconds * 1000)}
                {d.feedback ? ' · has feedback' : ''}
              </span>
            </button>
            <button class="btn btn-quiet" onClick={() => db.drills.remove(d.id, `Drill: ${d.title}`)} aria-label="Delete this attempt">
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
