// "Cut with AI": single cards, one card per claim, or a batch of files.
//
// The AI never writes card text. It answers with word numbers; the card is
// copied out of the article by position and then checked against it
// (src/core/cards/cutter.ts and verify.ts). A cut that fails the check is
// rejected and nothing is saved.

import { useState } from 'preact/hooks';
import { aiCutCard, type AiCutOutput, type Density } from '../../ai/tasks';
import { AiError } from '../../ai/client';
import { formatUsd } from '../../ai/pricing';
import { CITE_FIELD_LABEL, unverifiedCiteFields } from '../../core/cards/cite';
import type { Cut } from '../../core/cards/verify';
import { importFile } from '../../core/import/source';
import { activeTopic, settings } from '../../data/store';
import type { Card, Cite } from '../../data/schema';
import { Field, Select, TextArea, TextInput, toast } from '../../ui/kit';
import type { CutContext, CutExtra } from '../cards/cardService';
import { AiButton, AiNeedsKey, AiStatus, useAi } from '../ai/AiUi';
import { aiMode } from '../ai/availability';

export interface AiCutProps {
  context: () => CutContext;
  addCut: (ctx: CutContext, cut: Cut, extra?: CutExtra) => Card | null;
  claim: string;
  onClaim: (claim: string) => void;
  /** Hand verified cite details back to the cutter's form. */
  onCite: (found: Partial<Cite>) => void;
}

/** Merge the debater's cite with what the AI found: typed values always win; AI values fill only blanks. */
function mergeCite(mine: Cite, found: Cite): Cite {
  const out = { ...mine };
  for (const k of Object.keys(found) as (keyof Cite)[]) if (!out[k].trim() && found[k].trim()) out[k] = found[k].trim();
  return out;
}

export function AiCutPanel({ context, addCut, claim, onClaim, onCite }: AiCutProps) {
  const ai = useAi();
  const [density, setDensity] = useState<Density>('medium');
  const [claims, setClaims] = useState('');
  const [mode, setMode] = useState<'one' | 'claims'>('one');
  const [progress, setProgress] = useState('');
  const ctx = context();
  const sourceChars = ctx.draft.text.length;
  const hasSource = ctx.draft.text.trim().length > 0;
  // Numbering every word roughly triples the size of the prompt.
  const promptChars = sourceChars * 3;

  /** One AI cut against a given context. Returns the card, or null if it was rejected. */
  const cutOnce = async (c: CutContext, wants: string, signal: AbortSignal): Promise<{ card: Card | null; out: AiCutOutput }> => {
    const out = await aiCutCard({
      source: c.draft.text,
      meta: c.draft.meta,
      side: c.side,
      claim: wants,
      tag: c.tag,
      density,
      topic: activeTopic(),
      term: c.kind === 'definition' ? c.term : undefined,
      signal,
    });
    const cite = mergeCite(c.cite, out.cite);
    const card = addCut(c, out.cut, {
      tag: out.tag,
      tagDraft: out.tagDraft,
      aiMarked: true,
      cite: { ...cite, initials: cite.initials.trim() || settings.value.initials },
      citeUnverified: unverifiedCiteFields(cite, c.draft.text, c.draft.meta),
    });
    return { card, out };
  };

  const describe = (out: AiCutOutput) => {
    const dropped = out.citeDropped.length ? ` It suggested a ${out.citeDropped.map((f) => CITE_FIELD_LABEL[f]).join(' and ')} that is not in the article, so that was thrown away.` : '';
    return `Card cut (${Math.round(out.density * 100)}% highlighted, ${formatUsd(out.usd)}). Check the highlighting and the tag.${dropped}`;
  };

  const runOne = () =>
    ai.run(async (signal) => {
      const c = context();
      const { card, out } = await cutOnce(c, claim, signal);
      if (card) {
        onCite(Object.fromEntries(Object.entries(out.cite).filter(([k, v]) => v && !c.cite[k as keyof Cite].trim())) as Partial<Cite>);
        toast(describe(out), { kind: 'success', ms: 8000 });
      }
    });

  const runClaims = () =>
    ai.run(async (signal) => {
      const list = claims.split('\n').map((l) => l.trim()).filter(Boolean);
      const c = context();
      let made = 0;
      let spent = 0;
      const failed: string[] = [];
      for (let i = 0; i < list.length; i++) {
        setProgress(`Cutting card ${i + 1} of ${list.length}: ${list[i].slice(0, 60)}`);
        try {
          const { card, out } = await cutOnce({ ...c, tag: '' }, list[i], signal);
          spent += out.usd;
          if (card) made++;
          else failed.push(list[i]);
        } catch (err) {
          if (err instanceof AiError && (err.kind === 'cancelled' || err.kind === 'locked' || err.kind === 'no-key' || err.kind === 'auth')) throw err;
          failed.push(list[i]);
        }
      }
      setProgress('');
      toast(`${made} card${made === 1 ? '' : 's'} cut (${formatUsd(spent)}).${failed.length ? ` ${failed.length} could not be cut: ${failed.join('; ').slice(0, 140)}` : ''}`, { kind: failed.length ? 'error' : 'success', ms: 10000 });
    }).finally(() => setProgress(''));

  const runFiles = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    void ai
      .run(async (signal) => {
        const base = context();
        let made = 0;
        let spent = 0;
        const failed: string[] = [];
        for (let i = 0; i < files.length; i++) {
          setProgress(`File ${i + 1} of ${files.length}: ${files[i].name}`);
          try {
            const src = await importFile(files[i]);
            // Each file gets its own source and its own cite: nothing typed for another article is reused.
            const blank: Cite = { first: '', last: '', year: '', date: '', quals: '', title: '', publication: '', url: '', accessed: '', pages: '', initials: settings.value.initials };
            const c: CutContext = { ...base, tag: '', cite: { ...blank, ...src.suggest }, draft: { kind: src.kind, name: src.name, url: src.url, text: src.text, meta: src.meta } };
            const { card, out } = await cutOnce(c, claim, signal);
            spent += out.usd;
            if (card) made++;
            else failed.push(files[i].name);
          } catch (err) {
            if (err instanceof AiError && (err.kind === 'cancelled' || err.kind === 'locked' || err.kind === 'no-key' || err.kind === 'auth')) throw err;
            failed.push(`${files[i].name} (${err instanceof Error ? err.message.slice(0, 60) : 'failed'})`);
          }
        }
        setProgress('');
        toast(`${made} card${made === 1 ? '' : 's'} cut from ${files.length} file${files.length === 1 ? '' : 's'} (${formatUsd(spent)}).${failed.length ? ` Not cut: ${failed.join('; ').slice(0, 200)}` : ''}`, {
          kind: failed.length ? 'error' : 'success',
          ms: 12000,
        });
      })
      .finally(() => setProgress(''));
  };

  const claimCount = claims.split('\n').filter((l) => l.trim()).length;

  // No key: one line instead of a panel of controls that could not do anything.
  const availability = aiMode();
  if (availability === 'hidden') return null;
  if (availability === 'no-key') return <AiNeedsKey what="Cutting a card with AI" />;

  return (
    <section class="subcard form-grid ai-cut" aria-label="Cut with AI">
      <h3>
        <span aria-hidden="true">✦</span> Cut with AI
      </h3>
      <p class="field-hint">
        The AI picks the passage and marks what to read. It cannot change the words: the card is copied from the article and checked against it. Its tag is a draft, and
        any cite detail it finds is kept only if it is really in the article.
      </p>
      <div class="row">
        <Field label="Highlighting" class="field-small">
          <Select
            value={density}
            onChange={setDensity}
            options={[
              { value: 'light', label: 'Light (15-25%)' },
              { value: 'medium', label: 'Medium (25-40%)' },
              { value: 'heavy', label: 'Heavy (40-55%)' },
            ]}
          />
        </Field>
        <Field label="Cut" class="field-small">
          <Select
            value={mode}
            onChange={setMode}
            options={[
              { value: 'one', label: 'One card' },
              { value: 'claims', label: 'Several cards from this article' },
            ]}
          />
        </Field>
      </div>
      {mode === 'one' ? (
        <>
          <Field label="What should the card prove? (optional)">
            <TextInput value={claim} onChange={onClaim} placeholder="e.g. single payer cuts administrative costs" />
          </Field>
          <AiButton ai={ai} onRun={runOne} tier="fast" promptChars={promptChars} outputTokens={900} disabled={!hasSource} primary>
            Cut a card with AI
          </AiButton>
        </>
      ) : (
        <>
          <Field label="One claim per line: each becomes its own card" hint="Tags are written by the AI as drafts for you to check.">
            <TextArea rows={4} value={claims} onChange={setClaims} placeholder={'coverage gaps are growing\nsingle payer cuts administrative costs'} />
          </Field>
          <AiButton ai={ai} onRun={runClaims} tier="fast" promptChars={promptChars * Math.max(1, claimCount)} outputTokens={900 * Math.max(1, claimCount)} disabled={!hasSource || !claimCount} primary>
            Cut {claimCount || ''} card{claimCount === 1 ? '' : 's'} with AI
          </AiButton>
        </>
      )}
      <div class="row-tight">
        <label class={`btn ${ai.busy ? 'is-disabled' : ''}`}>
          Batch: cut one card from each of several files…
          <input type="file" class="sr-only" multiple disabled={ai.busy} accept=".pdf,.docx,.html,.htm,.txt,application/pdf,text/html,text/plain" onChange={runFiles} />
        </label>
        <span class="field-hint">Uses the claim, side and labels above. Each file's cite is read from that file only.</span>
      </div>
      {progress && (
        <div class="notice" role="status">
          {progress}
        </div>
      )}
      <AiStatus ai={ai} />
    </section>
  );
}
