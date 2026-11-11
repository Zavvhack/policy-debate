// Cross-examination prep. PREP ONLY.
//
// Paste or import an opponent's disclosed cards and get questions to ask.
// This screen is part of Prep, which is not rendered at all while a round is
// on, and the AI call it makes is refused by the lock in any case. There is no
// "quick" or hidden version of it anywhere in Round Mode.

import { useState } from 'preact/hooks';
import { aiCxQuestions } from '../../ai/tasks';
import { formatUsd } from '../../ai/pricing';
import { tagText } from '../../core/cards/text';
import { docxToText, readDocx } from '../../core/docx/read';
import { activeTopic, db } from '../../data/store';
import { ExternalLink, Field, Segmented, TextArea, toast } from '../../ui/kit';
import { AiButton, AiSection, AiStatus, AiText, useAi } from '../ai/AiUi';
import { cardCiteText, copyItems } from '../cards/cardService';
import { newBlock } from '../blocks/blockService';
import { navigate } from '../../app/router';
import { newId } from '../../core/ids';

export function CxPrepPage() {
  const ai = useAi();
  const [cards, setCards] = useState('');
  const [side, setSide] = useState<'aff' | 'neg'>('neg');
  const [result, setResult] = useState<{ text: string; bad: string[] } | null>(null);

  const importFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = /\.docx$/i.test(file.name) ? docxToText(await readDocx(await file.arrayBuffer())) : await file.text();
      setCards((c) => (c.trim() ? `${c.trim()}\n\n${text}` : text));
      toast(`Added ${text.split(/\s+/).length.toLocaleString()} words from ${file.name}.`, { kind: 'success' });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { kind: 'error' });
    }
  };

  /** Use cards already imported into the library (e.g. an opponent's file). */
  const addFromLibrary = () => {
    const topicId = activeTopic()?.id;
    const theirs = db.cards.list.value.filter((c) => c.topicId === topicId && c.origin === 'import').slice(0, 25);
    if (!theirs.length) return toast('No imported cards in your library. Import their .docx on the Library page, or paste the cards here.', { kind: 'error' });
    const text = theirs.map((c) => `${tagText(c.tag)}\n${cardCiteText(c)}\n${c.text}`).join('\n\n');
    setCards((c) => (c.trim() ? `${c.trim()}\n\n${text}` : text));
  };

  const run = () =>
    ai.run(async (signal) => {
      const out = await aiCxQuestions({ topic: activeTopic(), cards, askingSide: side, signal });
      setResult({ text: out.text, bad: out.badQuotes });
      toast(`Questions ready (${formatUsd(out.usd)}).`, { kind: 'success' });
    });

  const saveAsBlock = () => {
    if (!result) return;
    const b = db.blocks.put(newBlock({ title: 'CX questions', side, category: 'other', items: [{ id: newId(), kind: 'analytic', text: result.text, draft: true }] }));
    navigate(`/blocks/${b.id}`);
  };

  const words = cards.trim() ? cards.trim().split(/\s+/).length : 0;
  return (
    <div class="page">
      <h1>CX question prep</h1>
      <p class="lead">
        Paste an opponent's disclosed evidence and get cross-examination questions to prepare: weak warrants, missing links, author qualifications, and things the card's own
        text concedes.
      </p>
      <div class="notice">
        <strong>Prep only.</strong> This tool does not exist in Round Mode in any form. Questions you want in a round should be saved as a block (in your own words) or
        written in your CX notes during the round by hand.
      </div>
      <AiSection title="Writing CX questions">
      <div class="card form-grid">
        <Field label="I will be asking as the" group>
          <Segmented
            ariaLabel="Your side"
            value={side}
            onChange={setSide}
            options={[
              { value: 'neg', label: 'Negative (questioning the aff)', class: 'seg-neg' },
              { value: 'aff', label: 'Affirmative (questioning the neg)', class: 'seg-aff' },
            ]}
          />
        </Field>
        <Field label={`Their evidence${words ? ` · ${words.toLocaleString()} words` : ''}`} hint="Paste tags, cites and full card text, exactly as disclosed.">
          <TextArea rows={12} value={cards} onChange={setCards} placeholder="Paste their cards here…" />
        </Field>
        <div class="row-tight">
          <label class="btn">
            Add from a file…
            <input type="file" class="sr-only" accept=".docx,.txt" onChange={importFile} />
          </label>
          <button class="btn" onClick={addFromLibrary}>
            Add imported cards from my library
          </button>
          <span class="field-hint">
            Teams disclose on <ExternalLink href="https://opencaselist.com">openCaselist</ExternalLink>. Download their file there yourself; this app does not fetch from it.
          </span>
        </div>
        <AiButton ai={ai} onRun={run} tier="strong" promptChars={cards.length + 2500} outputTokens={1800} disabled={words < 30} primary>
          Write CX questions
        </AiButton>
        <AiStatus ai={ai} />
      </div>
      </AiSection>
      {result && (
        <div class="card form-grid">
          <AiText text={result.text} badQuotes={result.bad} />
          <div class="row-tight">
            <button class="btn" onClick={() => copyItems([{ kind: 'text', text: result.text }])}>
              Copy
            </button>
            <button class="btn" onClick={saveAsBlock}>
              Save as a block to rewrite
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
