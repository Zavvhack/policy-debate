// The card cutter.
//
// Left: the source (pasted text, a file, or a fetched URL) and the cite.
// Right: the cards you have cut from it.
//
// However a card is cut - by hand here, or with AI help - its text is copied
// out of the source by position and then checked against it. See
// src/core/cards/verify.ts.

import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CITE_FIELD_LABEL, emptyCite, todayForCite, unverifiedCiteFields } from '../../core/cards/cite';
import { cutFromSource, type Cut } from '../../core/cards/verify';
import { importFetched, importFile, type ImportedSource } from '../../core/import/source';
import { activeTopic, db, settings } from '../../data/store';
import type { Card, CardSide, Cite, SourceDoc } from '../../data/schema';
import { platform } from '../../platform';
import { confirmDialog, Field, Segmented, TextArea, TextInput, toast, Unavailable } from '../../ui/kit';
import { CardEditor } from '../cards/CardView';
import { cardsToItems, copyItems, downloadDocx, knownLabels, parseLabels, saveCut, type CutContext, type CutExtra } from '../cards/cardService';
import { AiCutPanel } from './AiCut';

export interface CutterDraft {
  kind: SourceDoc['kind'];
  name: string;
  url: string;
  text: string;
  meta: string;
  note: string;
}

/** Lets another screen open the cutter ready for a particular job, e.g. "cut a definition of 'establish'". */
export const cutterPreset = signal<{ kind: Card['kind']; term: string } | null>(null);

const BLANK: CutterDraft = { kind: 'paste', name: '', url: '', text: '', meta: '', note: '' };

export function CutterPage() {
  const topic = activeTopic();
  const [draft, setDraft] = useState<CutterDraft>(BLANK);
  const [cite, setCite] = useState<Cite>(() => ({ ...emptyCite(settings.value.initials), accessed: '' }));
  const [side, setSide] = useState<CardSide>('neg');
  const [kind, setKind] = useState<Card['kind']>(() => cutterPreset.peek()?.kind ?? 'evidence');
  const [term, setTerm] = useState(() => cutterPreset.peek()?.term ?? '');
  // The preset is used once.
  useEffect(() => {
    cutterPreset.value = null;
  }, []);
  const [labels, setLabels] = useState('');
  const [tag, setTag] = useState('');
  const [claim, setClaim] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [busy, setBusy] = useState('');
  const [cutIds, setCutIds] = useState<string[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Cite fields that are filled in but cannot be found in the source: shown as you type.
  const missing = useMemo(() => (draft.text.trim() ? unverifiedCiteFields(cite, draft.text, draft.meta) : []), [cite, draft.text, draft.meta]);
  const cards = cutIds.map((id) => db.cards.list.value.find((c) => c.id === id)).filter((c): c is Card => !!c);

  const loadSource = (src: ImportedSource) => {
    setDraft({ kind: src.kind, name: src.name, url: src.url, text: src.text, meta: src.meta, note: src.note });
    // Fill empty cite fields from what the page or file says about itself. Nothing typed is overwritten.
    setCite((c) => {
      const next = { ...c };
      for (const [k, v] of Object.entries(src.suggest) as [keyof Cite, string][]) if (!next[k].trim() && v) next[k] = v;
      if (!next.accessed.trim() && (src.url || src.kind === 'url')) next.accessed = todayForCite();
      if (!next.initials.trim()) next.initials = settings.value.initials;
      return next;
    });
    toast(`Loaded "${src.name.slice(0, 60)}". ${src.text.split(/\s+/).length.toLocaleString()} words.`, { kind: 'success' });
  };

  const run = async (label: string, job: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await job();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { kind: 'error', ms: 9000 });
    } finally {
      setBusy('');
    }
  };

  const pickFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files[0]) void run('Reading the file…', async () => loadSource(await importFile(files[0])));
  };

  const fetchUrl = () =>
    run('Fetching the page…', async () => {
      const url = urlInput.trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('Type a full web address, starting with https://');
      loadSource(await importFetched(await platform.fetchUrl(url)));
    });

  const context = (): CutContext => ({ draft, cite, side, kind, term, labels: parseLabels(labels), tag });

  /** Save a cut as a card and show it in this session's list. Explains why if the cut is rejected. */
  const addCut = (ctx: CutContext, cut: Cut, extra: CutExtra = {}): Card | null => {
    const result = saveCut(ctx, cut, extra);
    if (typeof result === 'string') {
      toast(`This cut was rejected: ${result}`, { kind: 'error', ms: 9000 });
      return null;
    }
    setCutIds((ids) => [result.id, ...ids]);
    return result;
  };

  const cutSelection = () => {
    const el = textRef.current;
    if (!el) return;
    if (el.selectionStart === el.selectionEnd) {
      toast('Select the part of the article you want as the card (drag over it), then press this.', { kind: 'error' });
      return;
    }
    const cut = cutFromSource(draft.text, el.selectionStart, el.selectionEnd);
    if (!cut) {
      toast('That selection has no words in it.', { kind: 'error' });
      return;
    }
    if (addCut(context(), cut)) toast('Card cut. Now underline and highlight it.', { kind: 'success' });
  };

  const clearSource = async () => {
    if (draft.text.trim() && !(await confirmDialog({ title: 'Start a new source?', body: 'The cards you have cut stay in your library. The article text and cite here are cleared.', confirm: 'Clear' }))) return;
    setDraft(BLANK);
    setCite({ ...emptyCite(settings.value.initials) });
    setTag('');
    setClaim('');
    setUrlInput('');
  };

  const setC = (patch: Partial<Cite>) => setCite((c) => ({ ...c, ...patch }));
  const citeInput = (field: keyof Cite, label: string, placeholder = '', small = false) => (
    <Field
      label={label}
      class={small ? 'field-small' : ''}
      hint={missing.includes(field) ? <span class="warn-text">Not found in the article</span> : undefined}
    >
      <TextInput value={cite[field]} onChange={(v) => setC({ [field]: v })} placeholder={placeholder} />
    </Field>
  );
  const words = draft.text.trim() ? draft.text.trim().split(/\s+/).length : 0;

  return (
    <div class="page page-wide cutter">
      <div class="page-head">
        <div>
          <h1>Card cutter</h1>
          <p class="lead">
            A card's text is copied straight from the article and checked against it, character for character. Nothing here can reword evidence.
          </p>
        </div>
        {topic && <span class="pill">Topic: {topic.name}</span>}
      </div>
      <div class="cutter-grid">
        <section class="card form-grid cutter-source">
          <h2>1. The source</h2>
          <div class="row-tight">
            <label class="btn">
              Open a file…
              <input type="file" class="sr-only" accept=".pdf,.docx,.html,.htm,.txt,.md,application/pdf,text/html,text/plain" onChange={pickFile} />
            </label>
            <span class="field-hint">PDF, Word (.docx), a saved web page, or text.</span>
          </div>
          {platform.can.fetchUrl ? (
            <div class="row-tight url-row">
              <TextInput type="url" value={urlInput} onChange={setUrlInput} placeholder="https://… paste an article's address" aria-label="Article address" onKeyDown={(e) => e.key === 'Enter' && fetchUrl()} />
              <button class="btn" onClick={fetchUrl} disabled={!!busy || !urlInput.trim()}>
                Fetch
              </button>
            </div>
          ) : (
            <Unavailable>
              <strong>Fetching from a URL needs the desktop app.</strong> A browser will not let a page read other websites. Here, copy the article and paste it below, or save
              the page and use "Open a file".
            </Unavailable>
          )}
          {busy && (
            <div class="notice" role="status">
              {busy}
            </div>
          )}
          {draft.note && <div class="notice">{draft.note}</div>}
          <Field label={`Article text${words ? ` · ${words.toLocaleString()} words` : ''}`} hint="Paste the article here. Include the byline, date and publication at the top if you can: the cite is checked against this text.">
            <textarea
              ref={textRef}
              class="input textarea source-text"
              rows={14}
              spellcheck={false}
              value={draft.text}
              placeholder="Paste the article…"
              onInput={(e) => setDraft({ ...draft, text: (e.target as HTMLTextAreaElement).value, kind: draft.kind === 'paste' ? 'paste' : draft.kind })}
            />
          </Field>

          <h2>2. The cite</h2>
          <div class="row">
            {citeInput('first', 'Author first name')}
            {citeInput('last', 'Author last name')}
            {citeInput('year', 'Year', '2026', true)}
            {citeInput('date', 'Date', '1/28', true)}
          </div>
          {citeInput('quals', 'Qualifications', 'e.g. professor of health policy at …')}
          <div class="row">
            {citeInput('title', 'Title')}
            {citeInput('publication', 'Publication')}
          </div>
          <div class="row">
            <Field label="Link">
              <TextInput type="url" value={cite.url} onChange={(url) => setC({ url })} placeholder="https://…" />
            </Field>
            <Field label="Date accessed" class="field-small">
              <TextInput value={cite.accessed} onChange={(accessed) => setC({ accessed })} placeholder={todayForCite()} />
            </Field>
            <Field label="Pages" class="field-small">
              <TextInput value={cite.pages} onChange={(pages) => setC({ pages })} />
            </Field>
            <Field label="Cut by" class="field-small">
              <TextInput value={cite.initials} onChange={(initials) => setC({ initials })} placeholder={settings.value.initials || 'AB'} maxLength={6} />
            </Field>
          </div>
          {missing.length > 0 && (
            <p class="warn-text" role="status">
              Not found in the article text: {missing.map((f) => CITE_FIELD_LABEL[f]).join(', ')}. That is fine if you checked it elsewhere, but the card will carry a "check
              this" flag.
            </p>
          )}

          <h2>3. The card</h2>
          <div class="row">
            <Field label="Side" group>
              <Segmented
                ariaLabel="Side"
                value={side}
                onChange={setSide}
                options={[
                  { value: 'neg', label: 'Neg', class: 'seg-neg' },
                  { value: 'aff', label: 'Aff', class: 'seg-aff' },
                  { value: 'both', label: 'Both' },
                ]}
              />
            </Field>
            <Field label="Type" group>
              <Segmented
                ariaLabel="Type"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'evidence', label: 'Evidence' },
                  { value: 'definition', label: 'Definition (for T)' },
                ]}
              />
            </Field>
          </div>
          {kind === 'definition' && (
            <Field label="Word or phrase being defined">
              <TextInput value={term} onChange={setTerm} list="topic-terms" placeholder="e.g. establish" />
            </Field>
          )}
          <Field label="Tag (optional now; you can write it on the card)" hint="Put [[double brackets]] around a key phrase to underline it.">
            <TextInput value={tag} onChange={setTag} />
          </Field>
          <Field label="Labels" hint="The argument this belongs to, e.g. Econ DA. Separate several with commas.">
            <TextInput value={labels} onChange={setLabels} list="known-labels" />
          </Field>
          <datalist id="known-labels">
            {knownLabels().map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <datalist id="topic-terms">
            {(topic?.keyTerms ?? []).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <div class="cut-actions">
            <button class="btn btn-primary" onClick={cutSelection} disabled={!draft.text.trim()}>
              Cut the selected text by hand
            </button>
            <span class="field-hint">Drag over the part of the article you want, then press this. You do the underlining on the card.</span>
          </div>
          <AiCutPanel context={context} addCut={addCut} claim={claim} onClaim={setClaim} onCite={(found) => setCite((c) => ({ ...c, ...found }))} />
          <div>
            <button class="btn btn-quiet" onClick={clearSource}>
              Start a new source
            </button>
          </div>
        </section>

        <section class="cutter-cards" aria-label="Cards cut in this session">
          <div class="row-tight cards-bar">
            <h2>Cards from this session{cards.length ? ` (${cards.length})` : ''}</h2>
            <span class="spacer" />
            <button class="btn" disabled={!cards.length} onClick={() => copyItems(cardsToItems(cards))}>
              Copy all
            </button>
            <button class="btn" disabled={!cards.length} onClick={() => downloadDocx(cards.length === 1 ? `${cards[0].cite.last || 'Card'} ${cards[0].cite.year}` : 'Cut cards', cardsToItems(cards))}>
              Download .docx
            </button>
          </div>
          {!cards.length && (
            <div class="empty">
              Cards you cut appear here, and are saved to your library straight away.
              <br />
              Select part of the article and press "Cut the selected text by hand".
            </div>
          )}
          {cards.map((card) => (
            <CardEditor
              key={card.id}
              card={card}
              onChange={(c) => db.cards.put(c, 200)}
              actions={
                <>
                  <button class="btn btn-quiet" onClick={() => copyItems(cardsToItems([card]))}>
                    Copy
                  </button>
                  <button
                    class="btn btn-quiet"
                    onClick={() => {
                      db.cards.remove(card.id, `Card: ${card.tag.map((p) => p.t).join('').slice(0, 50) || card.cite.last || 'untitled'}`);
                      toast('Card deleted. You can restore it from Settings → Backup.');
                    }}
                  >
                    Delete
                  </button>
                </>
              }
            />
          ))}
        </section>
      </div>
    </div>
  );
}
