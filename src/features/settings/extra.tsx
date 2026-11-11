// Settings sections that belong to other features (card format, AI).
// They are listed here so Settings.tsx does not need to know about them.

import { refreshAiKey } from '../ai/availability';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { aiLog, testApiKey } from '../../ai/client';
import { formatUsd, modelInfo, MODELS, PRICES_AS_OF } from '../../ai/pricing';
import { platform } from '../../platform';
import { WORD_HIGHLIGHT_LABEL } from '../../core/docx/write';
import { setLevel } from '../../core/cards/text';
import { emptyCite } from '../../core/cards/cite';
import { settings, updateSettings } from '../../data/store';
import type { WordHighlight } from '../../data/schema';
import { Field, Select, TextInput, Toggle } from '../../ui/kit';
import { CardBody } from '../cards/CardView';

const SAMPLE_TEXT = 'Roughly 26 million Americans remain uninsured. That number is not falling, and expired subsidies pushed premiums higher in most states.';
const SAMPLE_MARKS = setLevel(SAMPLE_TEXT, setLevel(SAMPLE_TEXT, setLevel(SAMPLE_TEXT, [], 0, 73, 1), 8, 45, 2), 36, 46, 3);

function CardFormat() {
  const s = settings.value;
  const h = s.highlight;
  const set = (patch: Partial<typeof h>) => updateSettings((cur) => ({ ...cur, highlight: { ...cur.highlight, ...patch } }));
  const wordOptions = (Object.keys(WORD_HIGHLIGHT_LABEL) as WordHighlight[]).map((k) => ({ value: k, label: WORD_HIGHLIGHT_LABEL[k] }));
  const sample = {
    tag: [{ t: 'Coverage gaps are ' }, { t: 'not closing', u: true }],
    cite: { ...emptyCite(s.initials || 'AB'), first: 'Maria', last: 'Okafor', year: '2026', quals: 'professor of health policy', title: 'Why gaps persist', publication: 'Example Review', date: '1/28' },
    text: SAMPLE_TEXT,
    marks: SAMPLE_MARKS,
  };
  return (
    <section class="card form-grid">
      <h2>Cards</h2>
      <Field label="My initials" hint="Added to the end of every cite you cut, like //AB.">
        <TextInput value={s.initials} onChange={(initials) => updateSettings({ initials: initials.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 6) })} placeholder="AB" />
      </Field>
      <Field label="Highlight colours">
        <Select
          value={h.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'custom', label: 'Soft colours (easiest to read; best for Google Docs)' },
            { value: 'word', label: "Word's own highlighters (best with Verbatim's tools)" },
          ]}
        />
      </Field>
      {h.mode === 'custom' ? (
        <div class="row">
          <Field label="Neg (red / pink)" class="field-small">
            <input type="color" class="color-input" value={h.negColor} onInput={(e) => set({ negColor: (e.target as HTMLInputElement).value })} />
          </Field>
          <Field label="Aff (blue)" class="field-small">
            <input type="color" class="color-input" value={h.affColor} onInput={(e) => set({ affColor: (e.target as HTMLInputElement).value })} />
          </Field>
          <div class="align-end">
            <button class="btn" onClick={() => set({ negColor: '#ff9e9e', affColor: '#8fd3ff' })}>
              Reset colours
            </button>
          </div>
        </div>
      ) : (
        <>
          <div class="row">
            <Field label="Neg">
              <Select value={h.negWord} onChange={(negWord) => set({ negWord })} options={wordOptions} />
            </Field>
            <Field label="Aff">
              <Select value={h.affWord} onChange={(affWord) => set({ affWord })} options={wordOptions} />
            </Field>
          </div>
          <p class="field-hint">
            Word's "Blue" highlighter is too dark to read black text through, so Turquoise (cyan) is the default for aff. In this mode the .docx uses real Word highlighting,
            which Verbatim's highlight tools recognise. Soft colours are written as shading instead.
          </p>
        </>
      )}
      <Field label={`Unread text size: ${h.unreadPt}pt`}>
        <input type="range" min="5" max="9" step="1" value={h.unreadPt} onInput={(e) => set({ unreadPt: Number((e.target as HTMLInputElement).value) })} />
      </Field>
      <div>
        <div class="field-label">Preview</div>
        <div class="preview-pair">
          <div class="cardbox side-neg">
            <CardBody card={sample} side="neg" />
          </div>
          <div class="cardbox side-aff">
            <CardBody card={sample} side="aff" />
          </div>
        </div>
      </div>
    </section>
  );
}

function AiSettings() {
  const ai = settings.value.ai;
  const set = (patch: Partial<typeof ai>) => updateSettings((cur) => ({ ...cur, ai: { ...cur.ai, ...patch } }));
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void platform.hasApiKey().then(setHasKey, () => setHasKey(false));
  }, []);
  const spent = aiLog.value.reduce((sum, e) => sum + e.usd, 0);
  const modelOptions = (current: string) => [
    ...MODELS.map((m) => ({ value: m.id, label: `${m.label}  ($${m.inputPerM} in / $${m.outputPerM} out per million tokens)` })),
    ...(MODELS.some((m) => m.id === current) ? [] : [{ value: current, label: `${current} (typed by hand)` }]),
  ];

  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    setStatus(null);
    try {
      await platform.setApiKey(k, ai.rememberKey);
      setKey('');
      setHasKey(true);
      void refreshAiKey();
      // Saving a key means you want AI: make sure its buttons are showing.
      if (!settings.value.ai.show) set({ show: true });
      setStatus({ ok: true, text: 'Key saved. Press "Test the key" to check it works.' });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await testApiKey() });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    await platform.clearApiKey();
    setHasKey(false);
    void refreshAiKey();
    setStatus({ ok: true, text: 'Key removed from this computer.' });
  };

  return (
    <>
      <section class="card form-grid">
        <h2>AI</h2>
        <p>
          AI help uses Claude, through <strong>your own Anthropic API key</strong>. You pay Anthropic directly for what you use; this app adds nothing and has no server of
          its own. AI works only in Prep. During a round it is switched off in the code itself.
        </p>
        <Toggle
          checked={ai.show}
          onChange={(show) => set({ show })}
          label="Show AI features"
          hint="Off: AI buttons and the AI-only page disappear from Prep. Nothing else changes. Turn this off if you do not have a key and do not want one."
        />
        <div class="format-summary">
          <strong>{hasKey === null ? 'Checking…' : hasKey ? 'A key is saved.' : 'No key saved. AI is optional: the rest of the app does not need one.'}</strong>
          <div class="muted">{platform.keyStorageNote}</div>
        </div>
        <Field label={hasKey ? 'Replace the key' : 'API key'} hint={<>Get one at console.anthropic.com → API keys. It starts with <code>sk-ant-</code>. Never share it or put it in a document.</>}>
          <TextInput type="password" value={key} onChange={setKey} placeholder="sk-ant-…" aria-label="API key" />
        </Field>
        {platform.kind === 'browser' && (
          <Toggle
            checked={ai.rememberKey}
            onChange={(rememberKey) => set({ rememberKey })}
            label="Remember the key in this browser"
            hint="Off (safer): the key is forgotten when you close this tab. On: it is saved in this browser as plain text. Leave it off on any computer you share."
          />
        )}
        <div class="row-tight">
          <button class="btn btn-primary" onClick={save} disabled={busy || !key.trim()}>
            Save key
          </button>
          <button class="btn" onClick={test} disabled={busy || !hasKey}>
            Test the key
          </button>
          <button class="btn btn-danger-quiet" onClick={remove} disabled={busy || !hasKey}>
            Remove the key
          </button>
        </div>
        {status && (
          <div class={`notice ${status.ok ? '' : 'notice-danger'}`} role="status">
            {status.text}
          </div>
        )}
      </section>

      <section class="card form-grid">
        <h2>Models</h2>
        <Field label="Quick model: formatting jobs (marking up cards, filling templates)" hint={modelInfo(ai.fastModel).blurb}>
          <Select value={ai.fastModel} onChange={(fastModel) => set({ fastModel })} options={modelOptions(ai.fastModel)} />
        </Field>
        <Field label="Strong model: strategy (blocks, topicality, CX questions, feedback)" hint={modelInfo(ai.strongModel).blurb}>
          <Select value={ai.strongModel} onChange={(strongModel) => set({ strongModel })} options={modelOptions(ai.strongModel)} />
        </Field>
        <p class="field-hint">
          Every AI button shows a rough cost before you press it. Prices here were copied from Anthropic's list on {PRICES_AS_OF} and are estimates only; your real usage is on
          console.anthropic.com.
        </p>
        <div class="format-summary">
          <strong>Used since you opened the app: {aiLog.value.length ? formatUsd(spent) : 'nothing yet'}</strong>
          {aiLog.value.length > 0 && (
            <ul class="plain-list muted">
              {aiLog.value
                .slice(-8)
                .reverse()
                .map((e) => (
                  <li key={e.at}>
                    {e.task} · {modelInfo(e.model).label} · {e.inputTokens.toLocaleString()} in, {e.outputTokens.toLocaleString()} out · {formatUsd(e.usd)}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      <section class="card form-grid">
        <h2>The rules, in short</h2>
        <ul class="rules-list">
          <li>
            <strong>NSDA:</strong> in debate events generative AI "should not be cited as a source". It may be used "to guide students to articles, ideas, and sources", and
            the original source of any evidence "must be available if requested" (High School Unified Manual 2026-27).
          </li>
          <li>
            <strong>During rounds:</strong> NSDA's device rules bar receiving "information not generated by the participating competitors in your round". Many leagues and
            states ban AI in rounds outright. This app's rule is stricter than any of them: no AI in a round, ever.
          </li>
          <li>
            <strong>What that means here:</strong> AI never writes evidence. Cards are copied from the source and checked against it. Tags, blocks and feedback from AI are
            labelled as drafts for you to check and rewrite.
          </li>
          <li>Rules differ by league and change. Check your own league's and each tournament's rules.</li>
        </ul>
      </section>
    </>
  );
}

export const EXTRA_SETTINGS: { id: string; label: string; render: () => ComponentChildren }[] = [
  { id: 'cards', label: 'Cards', render: () => <CardFormat /> },
  { id: 'ai', label: 'AI', render: () => <AiSettings /> },
];
