// The block writer.
//
// A block is a numbered list of arguments in YOUR words (analytics), optionally
// with cards from your library placed between them. The two are kept visibly
// separate everywhere: an analytic is plain text you wrote; a card is a card.
//
// Templates are fill-in-the-blank blocks you own. AI can suggest a filled-in
// version here in Prep. In a round, you fill the blanks in by hand.

import { useMemo, useState } from 'preact/hooks';
import { aiDraftBlock, aiFillTemplate } from '../../ai/tasks';
import { formatUsd } from '../../ai/pricing';
import { blanksOf, fillBlanks, splitBlanks } from '../../core/blocks/templates';
import { tagText } from '../../core/cards/text';
import { SPEECHES, type Side, type SpeechId } from '../../core/debate/formats';
import { newId, now } from '../../core/ids';
import { searchItems } from '../../core/search';
import { activeTopic, db } from '../../data/store';
import type { ArgCategory, Block, BlockItem, BlockTemplate, Card } from '../../data/schema';
import { navigate } from '../../app/router';
import { confirmDialog, Field, openDialog, Segmented, Select, TextArea, TextInput, toast } from '../../ui/kit';
import { AiButton, AiDraftNote, AiSection, AiStatus, useAi } from '../ai/AiUi';
import { CardBody } from '../cards/CardView';
import { cardSearchFields, cardShortCite, copyItems, downloadDocx, highlightSide, knownLabels } from '../cards/cardService';
import { blockFromTemplate, blockSearchFields, blockTitle, blockToItems, CATEGORY_LABEL, newBlock } from './blockService';

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ArgCategory[];
const SPEECH_OPTIONS: { value: SpeechId | 'any'; label: string }[] = [{ value: 'any', label: 'Any speech' }, ...SPEECHES.map((s) => ({ value: s, label: s }))];

/** Choose a card from the library. Resolves with the card's id. */
export function pickCard(filter?: (c: Card) => boolean): Promise<string | undefined> {
  return openDialog<string>((close) => {
    const Body = () => {
      const [q, setQ] = useState('');
      const topicId = activeTopic()?.id;
      const cards = db.cards.list.value.filter((c) => c.topicId === topicId && (!filter || filter(c)));
      const shown = searchItems(cards, q, cardSearchFields).slice(0, 60);
      return (
        <>
          <h2 class="dialog-title">Choose a card from your library</h2>
          <div class="dialog-body">
            <TextInput type="search" value={q} onChange={setQ} placeholder="Search…" aria-label="Search cards" autofocus />
            <ul class="list pick-list">
              {!shown.length && <li class="empty">{cards.length ? 'Nothing matches.' : 'No cards to choose from yet. Cut or import some first.'}</li>}
              {shown.map((c) => (
                <li key={c.id} class="list-row">
                  <button class="list-main" onClick={() => close(c.id)}>
                    <span class={`pill ${c.side === 'aff' ? 'side-aff' : c.side === 'neg' ? 'side-neg' : ''}`}>{c.side === 'both' ? 'Both' : c.side === 'aff' ? 'Aff' : 'Neg'}</span>
                    <span class="list-title">{tagText(c.tag) || '(no tag)'}</span>
                    <span class="muted list-meta">
                      {cardShortCite(c)}
                      {c.kind === 'definition' && c.term ? ` · defines "${c.term}"` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div class="dialog-actions">
            <button class="btn" onClick={() => close()}>
              Cancel
            </button>
          </div>
        </>
      );
    };
    return <Body />;
  });
}

function BlockEditor({ block }: { block: Block }) {
  const ai = useAi();
  const [notes, setNotes] = useState('');
  const save = (patch: Partial<Block>, delay = 250) => db.blocks.put({ ...block, ...patch }, delay);
  const setItem = (id: string, patch: Partial<BlockItem>) => save({ items: block.items.map((it) => (it.id === id ? ({ ...it, ...patch } as BlockItem) : it)) });
  const addItem = (item: BlockItem, afterId?: string) => {
    const items = [...block.items];
    const at = afterId ? items.findIndex((it) => it.id === afterId) : -1;
    items.splice(at < 0 ? items.length : at + 1, 0, item);
    save({ items }, 0);
  };
  const removeItem = (id: string) => save({ items: block.items.filter((it) => it.id !== id) }, 0);
  const moveItem = (id: string, dir: -1 | 1) => {
    const items = [...block.items];
    const at = items.findIndex((it) => it.id === id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= items.length) return;
    [items[at], items[to]] = [items[to], items[at]];
    save({ items }, 0);
  };
  const addCard = async (afterId?: string) => {
    const id = await pickCard();
    if (id) addItem({ id: newId(), kind: 'card', cardId: id }, afterId);
  };

  const library = useMemo(() => {
    const topicId = activeTopic()?.id;
    // Offer the AI the cards most likely to be relevant: same label as what this block answers, then the same side.
    const cards = db.cards.list.value.filter((c) => c.topicId === topicId && c.kind === 'evidence' && (c.side === block.side || c.side === 'both'));
    const labelled = block.answersTo.trim() ? cards.filter((c) => c.labels.some((l) => l.toLowerCase() === block.answersTo.trim().toLowerCase())) : [];
    return [...new Set([...labelled, ...cards])].slice(0, 40).map((c) => ({ id: c.id, tag: tagText(c.tag) || '(no tag)', cite: cardShortCite(c) }));
  }, [db.cards.list.value, block.side, block.answersTo]);

  const draft = () =>
    ai.run(async (signal) => {
      const out = await aiDraftBlock({ topic: activeTopic(), side: block.side, speech: block.speech, answersTo: block.answersTo, notes, library, signal });
      const fresh: BlockItem[] = out.items.map((it) => (it.kind === 'card' ? { id: newId(), kind: 'card', cardId: it.cardId } : { id: newId(), kind: 'analytic', text: it.text, draft: true }));
      // Keep whatever the debater already wrote; AI drafts are added below it.
      const kept = block.items.filter((it) => it.kind !== 'analytic' || it.text.trim());
      save({ items: [...kept, ...fresh], title: block.title || out.title }, 0);
      toast(`Draft added (${formatUsd(out.usd)}). Each AI point is marked until you edit or confirm it.`, { kind: 'success', ms: 7000 });
    });

  let n = 0;
  const drafts = block.items.filter((it) => it.kind === 'analytic' && it.draft).length;
  return (
    <div class="block-editor">
      <div class="card form-grid">
        <div class="row">
          <Field label="Title">
            <TextInput value={block.title} onChange={(title) => save({ title })} placeholder={blockTitle({ ...block, title: '' })} />
          </Field>
          <Field label="What it answers or extends">
            <TextInput value={block.answersTo} onChange={(answersTo) => save({ answersTo })} placeholder="e.g. Econ DA" list="known-labels" />
          </Field>
        </div>
        <div class="row">
          <Field label="Side" group>
            <Segmented
              ariaLabel="Side"
              value={block.side}
              onChange={(side: Side) => save({ side }, 0)}
              options={[
                { value: 'aff', label: 'Aff', class: 'seg-aff' },
                { value: 'neg', label: 'Neg', class: 'seg-neg' },
              ]}
            />
          </Field>
          <Field label="Speech" class="field-small">
            <Select value={block.speech} onChange={(speech) => save({ speech }, 0)} options={SPEECH_OPTIONS} />
          </Field>
          <Field label="Kind of argument" class="field-small">
            <Select value={block.category} onChange={(category) => save({ category }, 0)} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
          </Field>
        </div>
        <datalist id="known-labels">
          {knownLabels().map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>

      <div class="block-items">
        {block.items.map((it) => {
          const tools = (
            <span class="item-tools">
              <button class="icon-btn" onClick={() => moveItem(it.id, -1)} aria-label="Move up">
                ↑
              </button>
              <button class="icon-btn" onClick={() => moveItem(it.id, 1)} aria-label="Move down">
                ↓
              </button>
              <button class="icon-btn" onClick={() => removeItem(it.id)} aria-label="Remove">
                ×
              </button>
            </span>
          );
          if (it.kind === 'heading') {
            return (
              <div key={it.id} class="block-item is-heading">
                <TextInput value={it.text} onChange={(text) => setItem(it.id, { text })} placeholder="Heading" aria-label="Heading" />
                {tools}
              </div>
            );
          }
          if (it.kind === 'analytic') {
            n++;
            return (
              <div key={it.id} class={`block-item is-analytic ${it.draft ? 'is-draft' : ''}`}>
                <span class="item-num" title="Your own words (an analytic)">
                  {n}.
                </span>
                <div class="item-main">
                  <TextArea rows={2} value={it.text} onChange={(text) => setItem(it.id, { text, draft: false })} placeholder="Your argument, in your own words. Use [blanks] for parts to fill in later." ariaLabel={`Point ${n}`} />
                  {it.draft && (
                    <div class="row-tight">
                      <span class="draft-chip">AI draft — check it</span>
                      <button class="link" onClick={() => setItem(it.id, { draft: false })}>
                        I have checked this
                      </button>
                    </div>
                  )}
                </div>
                {tools}
              </div>
            );
          }
          const card = db.cards.get(it.cardId);
          return (
            <div key={it.id} class="block-item is-card">
              <span class="item-num card-mark" title="Evidence from your library">
                Card
              </span>
              <div class="item-main">
                {card ? (
                  <details>
                    <summary>
                      <strong>{tagText(card.tag) || '(no tag)'}</strong> <span class="muted">· {cardShortCite(card)}</span>
                    </summary>
                    <CardBody card={card} side={highlightSide(card, block.side)} />
                    <button class="link" onClick={() => navigate(`/library/${card.id}`)}>
                      Open in the library
                    </button>
                  </details>
                ) : (
                  <span class="warn-text">This card is no longer in your library.</span>
                )}
              </div>
              {tools}
            </div>
          );
        })}
        <div class="row-tight add-row">
          <button class="btn" onClick={() => addItem({ id: newId(), kind: 'analytic', text: '' })}>
            + Point
          </button>
          <button class="btn" onClick={() => addCard()}>
            + Card from library
          </button>
          <button class="btn" onClick={() => addItem({ id: newId(), kind: 'heading', text: '' })}>
            + Heading
          </button>
          <span class="spacer" />
          <button class="btn" onClick={() => copyItems(blockToItems(block))}>
            Copy
          </button>
          <button class="btn" onClick={() => downloadDocx(blockTitle(block), blockToItems(block))}>
            Download .docx
          </button>
        </div>
      </div>

      <AiSection title="Drafting points for a block">
      <section class="subcard form-grid">
        <h3>
          <span aria-hidden="true">✦</span> Draft with AI
        </h3>
        <Field label="Anything it should know (optional)" hint="Their specific link story, what the judge likes, arguments you want included.">
          <TextArea rows={2} value={notes} onChange={setNotes} />
        </Field>
        <AiButton ai={ai} onRun={draft} tier="strong" promptChars={1500 + notes.length + library.length * 90} outputTokens={1500}>
          Draft points for this block
        </AiButton>
        <p class="field-hint">
          Drafts are added below what you have written, each marked as an AI draft. The AI can point to cards already in your library ({library.length} offered), but it
          cannot write evidence.
        </p>
        {drafts > 0 && <AiDraftNote>{drafts} point{drafts === 1 ? ' is' : 's are'} still marked as AI drafts. Rewrite them in your own words.</AiDraftNote>}
        <AiStatus ai={ai} />
      </section>
      </AiSection>

      <Field label="Notes to yourself">
        <TextArea rows={2} value={block.notes} onChange={(v) => save({ notes: v })} />
      </Field>
    </div>
  );
}

function TemplateFiller({ template }: { template: BlockTemplate }) {
  const ai = useAi();
  const [fills, setFills] = useState<Record<string, string>>({});
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [context, setContext] = useState('');
  const [editing, setEditing] = useState(false);
  const blanks = blanksOf(template.body);
  const save = (patch: Partial<BlockTemplate>) => db.templates.put({ ...template, ...patch }, 250);

  const suggest = () =>
    ai.run(async (signal) => {
      const out = await aiFillTemplate({ topic: activeTopic(), body: template.body, blanks, context, signal });
      const added = Object.keys(out.fills).filter((b) => out.fills[b] && !fills[b]?.trim());
      setFills((f) => ({ ...Object.fromEntries(added.map((b) => [b, out.fills[b]])), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())) }));
      setAiFilled(new Set(added));
      toast(added.length ? `Suggested ${added.length} blank${added.length === 1 ? '' : 's'} (${formatUsd(out.usd)}). Check each one.` : 'Nothing to suggest from what you described.', { kind: 'success' });
    });

  const toBlock = () => {
    const b = db.blocks.put(blockFromTemplate(template, fills));
    navigate(`/blocks/${b.id}`);
    toast('Saved as a block. Blanks you left empty are still marked [like this].', { kind: 'success' });
  };

  return (
    <div class="card form-grid">
      <div class="row-tight">
        <h2>{template.title}</h2>
        <span class="pill">{CATEGORY_LABEL[template.category]}</span>
        <span class="spacer" />
        <button class="btn btn-quiet" onClick={() => setEditing(!editing)}>
          {editing ? 'Done editing' : 'Edit the template'}
        </button>
        <button
          class="btn btn-quiet"
          onClick={async () => {
            if (await confirmDialog({ title: `Delete the "${template.title}" template?`, body: 'It can be restored from Settings → Backup for 30 days.', confirm: 'Delete', danger: true })) {
              db.templates.remove(template.id, `Template: ${template.title}`);
              navigate('/blocks/templates');
            }
          }}
        >
          Delete
        </button>
      </div>
      {editing ? (
        <>
          <Field label="Name">
            <TextInput value={template.title} onChange={(title) => save({ title })} />
          </Field>
          <Field label="When to use it">
            <TextInput value={template.description} onChange={(description) => save({ description })} />
          </Field>
          <Field label="Text" hint="Write blanks in [square brackets]. Each line becomes one numbered point.">
            <TextArea rows={10} value={template.body} onChange={(body) => save({ body })} />
          </Field>
        </>
      ) : (
        <>
          <p class="muted">{template.description}</p>
          <div class="template-body">
            {template.body.split('\n').map((line, i) => (
              <p key={i}>
                {splitBlanks(line).map((part, j) =>
                  'text' in part ? (
                    <span key={j}>{part.text}</span>
                  ) : (
                    <input
                      key={j}
                      class={`blank ${aiFilled.has(part.blank) && fills[part.blank] ? 'is-ai' : ''}`}
                      value={fills[part.blank] ?? ''}
                      placeholder={part.blank}
                      aria-label={part.blank}
                      size={Math.max(part.blank.length, (fills[part.blank] ?? '').length, 6)}
                      onInput={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        setFills((f) => ({ ...f, [part.blank]: v }));
                        setAiFilled((s) => {
                          const next = new Set(s);
                          next.delete(part.blank);
                          return next;
                        });
                      }}
                    />
                  ),
                )}
              </p>
            ))}
          </div>
          {aiFilled.size > 0 && <AiDraftNote>The shaded blanks were filled in by AI. Check each one; editing a blank clears the shading.</AiDraftNote>}
          <div class="row-tight">
            <button class="btn btn-primary" onClick={toBlock}>
              Save as a block
            </button>
            <button class="btn" onClick={() => copyItems([{ kind: 'text', text: fillBlanks(template.body, fills) }])}>
              Copy
            </button>
            <button class="btn btn-quiet" onClick={() => (setFills({}), setAiFilled(new Set()))}>
              Clear blanks
            </button>
          </div>
          <AiSection title="Suggesting what goes in the blanks">
          <section class="subcard form-grid">
            <h3>
              <span aria-hidden="true">✦</span> Suggest the blanks with AI
            </h3>
            <Field label="Describe the situation" hint="What they dropped, which cards are in play, the impacts on each side. The AI only uses what you write here.">
              <TextArea rows={3} value={context} onChange={setContext} />
            </Field>
            <AiButton ai={ai} onRun={suggest} tier="fast" promptChars={template.body.length + context.length + 600} outputTokens={400} disabled={!blanks.length}>
              Suggest
            </AiButton>
            <AiStatus ai={ai} />
          </section>
          </AiSection>
        </>
      )}
    </div>
  );
}

type SideFilter = 'all' | Side;

export function BlocksPage({ parts }: { parts: string[] }) {
  const topic = activeTopic();
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<SideFilter>('all');
  const [speech, setSpeech] = useState<SpeechId | 'any'>('any');
  const [category, setCategory] = useState<ArgCategory | 'all'>('all');
  const showTemplates = parts[1] === 'templates';
  const openId = showTemplates ? parts[2] : parts[1];

  const blocks = db.blocks.list.value;
  const mine = useMemo(() => blocks.filter((b) => b.topicId === topic?.id).sort((a, b) => b.updatedAt - a.updatedAt), [blocks, topic?.id]);
  const shown = useMemo(
    () =>
      searchItems(
        mine.filter((b) => (side === 'all' || b.side === side) && (speech === 'any' || b.speech === speech || b.speech === 'any') && (category === 'all' || b.category === category)),
        query,
        blockSearchFields,
      ),
    [mine, side, speech, category, query],
  );
  const templates = [...db.templates.list.value].sort((a, b) => a.createdAt - b.createdAt);
  const openBlock = !showTemplates ? mine.find((b) => b.id === openId) : undefined;
  const openTemplate = showTemplates ? templates.find((t) => t.id === openId) : undefined;

  const create = () => {
    const b = db.blocks.put(newBlock({ side: side === 'all' ? 'aff' : side, speech, category: category === 'all' ? 'other' : category }));
    navigate(`/blocks/${b.id}`);
  };
  const createTemplate = () => {
    const t = now();
    const tpl = db.templates.put({ id: newId(), createdAt: t, updatedAt: t, title: 'New template', description: '', side: 'both', category: 'other', body: 'They said [argument]. That is wrong because [reason].' });
    navigate(`/blocks/templates/${tpl.id}`);
  };
  const remove = async (b: Block) => {
    if (!(await confirmDialog({ title: `Delete "${blockTitle(b)}"?`, body: 'It can be restored from Settings → Backup for 30 days.', confirm: 'Delete', danger: true }))) return;
    db.blocks.remove(b.id, `Block: ${blockTitle(b)}`);
    navigate('/blocks');
  };

  return (
    <div class="page page-wide">
      <div class="page-head">
        <div>
          <h1>Blocks</h1>
          <p class="lead">Numbered arguments in your own words, built to answer specific arguments. Your saved blocks are available read-only in Round Mode.</p>
        </div>
        <div class="row-tight">
          <Segmented
            ariaLabel="Blocks or templates"
            value={showTemplates ? 'templates' : 'blocks'}
            onChange={(v) => navigate(v === 'templates' ? '/blocks/templates' : '/blocks')}
            options={[
              { value: 'blocks', label: `My blocks (${mine.length})` },
              { value: 'templates', label: `Templates (${templates.length})` },
            ]}
          />
          <button class="btn btn-primary" onClick={showTemplates ? createTemplate : create}>
            {showTemplates ? 'New template' : 'New block'}
          </button>
        </div>
      </div>

      {showTemplates ? (
        <div class="library-grid">
          <ul class="list library-list">
            {templates.map((t) => (
              <li key={t.id} class={`list-row ${t.id === openId ? 'is-open' : ''}`}>
                <button class="list-main" onClick={() => navigate(`/blocks/templates/${t.id}`)}>
                  <span class={`pill ${t.side === 'aff' ? 'side-aff' : t.side === 'neg' ? 'side-neg' : ''}`}>{t.side === 'both' ? 'Both' : t.side === 'aff' ? 'Aff' : 'Neg'}</span>
                  <span class="list-title">{t.title}</span>
                  <span class="muted list-meta">{t.description}</span>
                </button>
              </li>
            ))}
            {!templates.length && <li class="empty">No templates. Press "New template" to write one.</li>}
          </ul>
          <div>{openTemplate ? <TemplateFiller key={openTemplate.id} template={openTemplate} /> : <div class="empty">Choose a template to fill in. Templates are text you own: edit them however you like.</div>}</div>
        </div>
      ) : (
        <>
          <div class="library-bar">
            <TextInput type="search" value={query} onChange={setQuery} placeholder="Search blocks…" aria-label="Search blocks" />
            <Segmented
              ariaLabel="Side"
              value={side}
              onChange={setSide}
              options={[
                { value: 'all', label: 'All' },
                { value: 'aff', label: 'Aff', class: 'seg-aff' },
                { value: 'neg', label: 'Neg', class: 'seg-neg' },
              ]}
            />
            <Select ariaLabel="Speech" value={speech} onChange={setSpeech} options={SPEECH_OPTIONS} />
            <Select ariaLabel="Kind of argument" value={category} onChange={setCategory} options={[{ value: 'all', label: 'Any kind' }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]} />
          </div>
          <div class="library-grid">
            <ul class="list library-list">
              {!shown.length && <li class="empty">{mine.length ? 'Nothing matches.' : 'No blocks yet. Start one, or fill in a template.'}</li>}
              {shown.map((b) => (
                <li key={b.id} class={`list-row ${b.id === openId ? 'is-open' : ''}`}>
                  <button class="list-main" onClick={() => navigate(`/blocks/${b.id}`)}>
                    <span class={`pill side-${b.side}`}>{b.side === 'aff' ? 'Aff' : 'Neg'}</span>
                    <span class="list-title">{blockTitle(b)}</span>
                    <span class="muted list-meta">
                      {b.speech === 'any' ? '' : `${b.speech} · `}
                      {CATEGORY_LABEL[b.category]} · {b.items.filter((it) => it.kind === 'analytic' && it.text.trim()).length} points, {b.items.filter((it) => it.kind === 'card').length} cards
                    </span>
                  </button>
                  <button class="btn btn-quiet" onClick={() => remove(b)} aria-label={`Delete ${blockTitle(b)}`}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <div>{openBlock ? <BlockEditor key={openBlock.id} block={openBlock} /> : <div class="empty">Choose a block, or start a new one.</div>}</div>
          </div>
        </>
      )}
    </div>
  );
}
