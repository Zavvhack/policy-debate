// One card on screen: tag, cite and body, formatted exactly as it will export.
//
// In edit mode you can change the highlighting, the tag, the cite and the
// labels. You can NOT change the body text: it is a verbatim copy of the
// source, and the only thing the editor ever touches is the marks.
//
// Highlighting:
//   click a word        step it: small -> underline -> highlight -> emphasis
//   select + a button   set exactly the selected characters
//   select + key        U underline, H highlight, E emphasis, N none
//                       (Verbatim's keys work too: F9, F11, F10, F12)
//   Ctrl+Z              undo the last highlighting change

import type { CSSProperties } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { CITE_FIELD_LABEL, formatCite } from '../../core/cards/cite';
import { cardStats, cycleWord, parseTagMarkup, setLevel, tagToMarkup, toParagraphs } from '../../core/cards/text';
import { lintHighlights } from '../../core/cards/verify';
import type { Side } from '../../core/debate/formats';
import { highlightHex } from '../../core/docx/write';
import { settings } from '../../data/store';
import type { Card, Cite, Level, Mark } from '../../data/schema';
import { Field, Segmented, TextInput } from '../../ui/kit';
import { checkCard, highlightSide, parseLabels } from './cardService';

/** The read-only formatted card. Used everywhere a card is shown, including Round Mode. */
export function CardBody({ card, side }: { card: Pick<Card, 'tag' | 'cite' | 'citeRaw' | 'text' | 'marks'>; side: Side }) {
  const hl = highlightHex(settings.value.highlight, side);
  const style = { '--hl': hl, '--unread': `${settings.value.highlight.unreadPt}pt` } as CSSProperties;
  const cite = card.citeRaw?.length ? card.citeRaw : formatCite(card.cite);
  return (
    <div class="ev" style={style}>
      <p class="ev-tag">{card.tag.map((p, i) => (p.u ? <u key={i}>{p.t}</u> : <span key={i}>{p.t}</span>))}</p>
      {cite.length > 0 && <p class="ev-cite">{cite.map((p, i) => (p.big ? <b key={i}>{p.t}</b> : <span key={i}>{p.t}</span>))}</p>}
      <div class="ev-body">
        {toParagraphs(card.text, card.marks).map((para, i) => (
          <p key={i}>
            {para.runs.map((r) => (
              <span key={r.s} class={`lv${r.lv}`}>
                {r.t}
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}

/** The coloured "verified / not checked / MISMATCH" label. */
export function VerifyBadge({ card }: { card: Card }) {
  const result = useMemo(() => checkCard(card), [card.text, card.source?.sourceId, card.source?.start]);
  if (result.status === 'verified') {
    return (
      <span class="vbadge vbadge-ok" title="The card text matches its source character for character.">
        ✓ Matches source
      </span>
    );
  }
  if (result.status === 'no-source') {
    return (
      <span class="vbadge vbadge-none" title="This card was imported from a file, so there is no source article on file to check it against. Check it against the original yourself before reading it.">
        Imported · not checked against a source
      </span>
    );
  }
  return (
    <span class="vbadge vbadge-bad" role="alert" title={result.errors.join(' ')}>
      ✗ Does not match source — do not read
    </span>
  );
}

const LEVEL_BUTTONS: { lv: Level; label: string; key: string }[] = [
  { lv: 0, label: 'Small', key: 'N' },
  { lv: 1, label: 'Underline', key: 'U' },
  { lv: 2, label: 'Highlight', key: 'H' },
  { lv: 3, label: 'Emphasis', key: 'E' },
];

const KEY_LEVEL: Record<string, Level> = { n: 0, '0': 0, u: 1, '1': 1, h: 2, '2': 2, e: 3, '3': 3, F12: 0, F9: 1, F11: 2, F10: 3 };

/** The character range of the current text selection inside a card body, or null. */
function selectedRange(body: HTMLElement): { s: number; e: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer)) return null;
  let s = Infinity;
  let e = -1;
  body.querySelectorAll<HTMLElement>('[data-s]').forEach((span) => {
    if (!range.intersectsNode(span)) return;
    const base = Number(span.dataset.s);
    let a = base;
    let b = base + (span.textContent?.length ?? 0);
    if (span.firstChild === range.startContainer) a = base + range.startOffset;
    if (span.firstChild === range.endContainer) b = base + range.endOffset;
    if (b > a) {
      s = Math.min(s, a);
      e = Math.max(e, b);
    }
  });
  return e > s ? { s, e } : null;
}

interface EditorProps {
  card: Card;
  onChange: (card: Card) => void;
  /** Extra buttons for the card's header (Copy, Delete, ...). */
  actions?: preact.ComponentChildren;
  /** Start with the details (cite, labels) open. */
  detailsOpen?: boolean;
}

export function CardEditor({ card, onChange, actions, detailsOpen }: EditorProps) {
  const side = highlightSide(card);
  const hl = highlightHex(settings.value.highlight, side);
  const bodyRef = useRef<HTMLDivElement>(null);
  const undo = useRef<Mark[][]>([]);
  const [showDetails, setShowDetails] = useState(!!detailsOpen);
  const [tagDraftText, setTagDraftText] = useState<string | null>(null);
  const verify = useMemo(() => checkCard(card), [card.text, card.source?.sourceId, card.source?.start]);
  const lint = useMemo(() => lintHighlights(card.text, card.marks), [card.text, card.marks]);
  const stats = useMemo(() => cardStats(card.text, card.marks), [card.text, card.marks]);
  const paragraphs = useMemo(() => toParagraphs(card.text, card.marks), [card.text, card.marks]);

  const setMarks = (marks: Mark[]) => {
    undo.current.push(card.marks);
    if (undo.current.length > 100) undo.current.shift();
    // Only `marks` changes. `text` is copied through untouched.
    onChange({ ...card, marks });
  };
  const applyToSelection = (lv: Level): boolean => {
    const range = bodyRef.current ? selectedRange(bodyRef.current) : null;
    if (!range) return false;
    setMarks(setLevel(card.text, card.marks, range.s, range.e, lv));
    window.getSelection()?.removeAllRanges();
    return true;
  };
  const onBodyClick = (e: MouseEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the user is selecting, not clicking
    const span = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (!span) return;
    // Work out which character was clicked, so the right word is stepped even inside a long run.
    let offset = Number(span.dataset.s);
    const caret = sel?.anchorNode === span.firstChild ? sel?.anchorOffset ?? 0 : 0;
    offset += Math.min(caret, Math.max(0, (span.textContent?.length ?? 1) - 1));
    setMarks(cycleWord(card.text, card.marks, offset));
  };
  const onBodyKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      const prev = undo.current.pop();
      if (prev) {
        e.preventDefault();
        onChange({ ...card, marks: prev });
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const lv = KEY_LEVEL[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (lv !== undefined && applyToSelection(lv)) e.preventDefault();
  };

  const setCite = (patch: Partial<Cite>) => {
    const cite = { ...card.cite, ...patch };
    // Editing a field yourself clears its "not found in the source" flag: you have now vouched for it.
    const touched = Object.keys(patch);
    onChange({ ...card, cite, citeRaw: undefined, citeUnverified: card.citeUnverified.filter((f) => !touched.includes(f)) });
  };
  const citeField = (field: keyof Cite, label: string, placeholder = '', small = false) => (
    <Field label={label} class={small ? 'field-small' : ''} hint={card.citeUnverified.includes(field) ? <span class="warn-text">Not found in the source. Check it.</span> : undefined}>
      <TextInput value={card.cite[field]} onChange={(v) => setCite({ [field]: v })} placeholder={placeholder} />
    </Field>
  );

  const style = { '--hl': hl, '--unread': `${settings.value.highlight.unreadPt}pt` } as CSSProperties;
  const citeParts = card.citeRaw?.length ? card.citeRaw : formatCite(card.cite);

  return (
    <article class={`cardbox side-${side} ${verify.status === 'mismatch' ? 'is-bad' : ''}`}>
      <header class="cardbox-head">
        <span class={`pill side-${side}`}>{card.side === 'both' ? 'Both' : card.side === 'aff' ? 'Aff' : 'Neg'}</span>
        {card.kind === 'definition' && <span class="pill">Definition{card.term ? `: ${card.term}` : ''}</span>}
        <VerifyBadge card={card} />
        <span class="muted cardbox-stats">
          {stats.readWords} of {stats.words} words read ({stats.readPercent}%) · about {stats.readSeconds}s
        </span>
        <span class="cardbox-actions">{actions}</span>
      </header>

      {verify.status === 'mismatch' && (
        <div class="notice notice-danger" role="alert">
          <strong>This card does not match its source.</strong> {verify.errors.join(' ')} Do not read it. Cut it again from the source.
        </div>
      )}

      <div class="ev" style={style}>
        {tagDraftText === null ? (
          <p class="ev-tag ev-tag-edit" tabIndex={0} role="button" title="Click to edit the tag" onClick={() => setTagDraftText(tagToMarkup(card.tag))} onKeyDown={(e) => e.key === 'Enter' && setTagDraftText(tagToMarkup(card.tag))}>
            {card.tag.length ? card.tag.map((p, i) => (p.u ? <u key={i}>{p.t}</u> : <span key={i}>{p.t}</span>)) : <span class="muted">Click to write a tag</span>}
            {card.tagDraft && (
              <span class="draft-chip" title="Written by AI. Read the card and make sure the tag does not claim more than the evidence says, then confirm it.">
                AI draft — check it
              </span>
            )}
          </p>
        ) : (
          <div class="tag-editor">
            <textarea
              class="input textarea"
              rows={2}
              aria-label="Tag"
              autofocus
              value={tagDraftText}
              onInput={(e) => setTagDraftText((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onChange({ ...card, tag: parseTagMarkup(tagDraftText.replace(/\s*\n\s*/g, ' ').trim()), tagDraft: false });
                  setTagDraftText(null);
                } else if (e.key === 'Escape') setTagDraftText(null);
              }}
            />
            <div class="row-tight">
              <button
                class="btn btn-primary"
                onClick={() => {
                  onChange({ ...card, tag: parseTagMarkup(tagDraftText.replace(/\s*\n\s*/g, ' ').trim()), tagDraft: false });
                  setTagDraftText(null);
                }}
              >
                Save tag
              </button>
              <button class="btn" onClick={() => setTagDraftText(null)}>
                Cancel
              </button>
              <span class="field-hint">Put [[double brackets]] around a key phrase to underline it.</span>
            </div>
          </div>
        )}
        {card.tagDraft && tagDraftText === null && (
          <button class="btn btn-quiet confirm-tag" onClick={() => onChange({ ...card, tagDraft: false })}>
            I have checked this tag
          </button>
        )}
        {citeParts.length > 0 && <p class="ev-cite">{citeParts.map((p, i) => (p.big ? <b key={i}>{p.t}</b> : <span key={i}>{p.t}</span>))}</p>}

        <div class="hl-tools" role="toolbar" aria-label="Highlighting">
          {LEVEL_BUTTONS.map((b) => (
            <button
              key={b.lv}
              class={`btn hl-btn hl-btn-${b.lv}`}
              // Keep the text selection when the button is pressed.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!applyToSelection(b.lv)) bodyRef.current?.focus();
              }}
              title={`Select text in the card, then press this (or the ${b.key} key)`}
            >
              {b.label} <span class="kbd">{b.key}</span>
            </button>
          ))}
          <button class="btn btn-quiet" disabled={!undo.current.length} onClick={() => undo.current.length && onChange({ ...card, marks: undo.current.pop()! })}>
            Undo
          </button>
          <span class="field-hint">Click a word to step it up a level, or select text and press a button.</span>
        </div>

        <div class="ev-body ev-body-edit" ref={bodyRef} tabIndex={0} onClick={onBodyClick} onKeyDown={onBodyKey} aria-label="Card text. Select words and press U, H, E or N to change the highlighting.">
          {paragraphs.map((para, i) => (
            <p key={i}>
              {para.runs.map((r) => (
                <span key={r.s} data-s={r.s} class={`lv${r.lv}`}>
                  {r.t}
                </span>
              ))}
            </p>
          ))}
        </div>
      </div>

      {(verify.warnings.length > 0 || lint.length > 0 || card.citeUnverified.length > 0) && (
        <ul class="card-warnings">
          {card.citeUnverified.length > 0 && (
            <li>
              Cite: the {card.citeUnverified.map((f) => CITE_FIELD_LABEL[f as keyof Cite] ?? f).join(', ')} could not be found in the source text. Check{' '}
              {card.citeUnverified.length === 1 ? 'it' : 'them'} against the original.
            </li>
          )}
          {[...verify.warnings, ...lint].map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {card.aiMarked && <p class="field-hint">AI chose this highlighting. It is a starting point: read it through and fix it before you use the card.</p>}

      <button class="link details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>
        {showDetails ? 'Hide' : 'Edit'} cite, side and labels
      </button>
      {showDetails && (
        <div class="form-grid card-details">
          <div class="row">
            <Field label="Side" group>
              <Segmented
                ariaLabel="Side"
                value={card.side}
                onChange={(s) => onChange({ ...card, side: s })}
                options={[
                  { value: 'aff', label: 'Aff', class: 'seg-aff' },
                  { value: 'neg', label: 'Neg', class: 'seg-neg' },
                  { value: 'both', label: 'Both' },
                ]}
              />
            </Field>
            <Field label="Type" group>
              <Segmented
                ariaLabel="Type"
                value={card.kind}
                onChange={(kind) => onChange({ ...card, kind })}
                options={[
                  { value: 'evidence', label: 'Evidence' },
                  { value: 'definition', label: 'Definition' },
                ]}
              />
            </Field>
            {card.kind === 'definition' && (
              <Field label="Word or phrase defined">
                <TextInput value={card.term} onChange={(term) => onChange({ ...card, term })} list="topic-terms" />
              </Field>
            )}
          </div>
          <Field label="Labels" hint="The arguments this card belongs to, separated by commas (e.g. Econ DA, States CP).">
            <TextInput value={card.labels.join(', ')} onChange={(v) => onChange({ ...card, labels: parseLabels(v) })} />
          </Field>
          {card.citeRaw?.length ? (
            <p class="field-hint">This cite was imported as written. Filling in the fields below replaces it with a cite in your own format.</p>
          ) : null}
          <div class="row">
            {citeField('first', 'Author first name')}
            {citeField('last', 'Author last name')}
            {citeField('year', 'Year', '2026', true)}
            {citeField('date', 'Date', '1/28', true)}
          </div>
          {citeField('quals', 'Qualifications')}
          <div class="row">
            {citeField('title', 'Title')}
            {citeField('publication', 'Publication')}
          </div>
          <div class="row">
            {citeField('url', 'Link')}
            {citeField('accessed', 'Date accessed', '', true)}
            {citeField('pages', 'Pages', '', true)}
            {citeField('initials', 'Cut by', 'AB', true)}
          </div>
          {card.citeUnverified.length > 0 && (
            <p class="warn-text">
              Not found in the source text: {card.citeUnverified.map((f) => CITE_FIELD_LABEL[f as keyof Cite] ?? f).join(', ')}. Check these against the original before you
              read the card.
            </p>
          )}
          <Field label="Notes">
            <TextInput value={card.notes} onChange={(notes) => onChange({ ...card, notes })} />
          </Field>
        </div>
      )}
    </article>
  );
}
