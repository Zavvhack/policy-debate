// The non-card things Round Mode can show: your saved blocks, T files and
// fill-in-the-blank templates.
//
// This reads saved data only. Blanks are filled in BY HAND, by you, during the
// round; nothing here can generate text. It must never import the AI client
// (a test enforces that for everything in this folder).

import type { ComponentChildren } from 'preact';
import { blanksOf, fillBlanks, splitBlanks } from '../../core/blocks/templates';
import { tagText } from '../../core/cards/text';
import type { DocItem } from '../../core/docx/write';
import type { SearchField } from '../../core/search';
import { db } from '../../data/store';
import type { Block, BlockTemplate, CardSide, Round, TFile } from '../../data/schema';
import { CATEGORY_LABEL, blockSearchFields, blockTitle, blockToItems, ROLE_LABEL, tFileSearchFields, tFileSide, tFileTitle, tFileToItems } from '../blocks/blockService';
import { CardBody } from '../cards/CardView';
import { cardShortCite, highlightSide } from '../cards/cardService';

export interface RoundDocEntry {
  key: string;
  type: 'card' | 'block' | 'tfile';
  title: string;
  sub: string;
  side: CardSide;
  fields: SearchField[];
  /** The entry as export items (for copying and the speech doc). */
  items: () => DocItem[];
  render: () => ComponentChildren;
}

type Fills = Record<string, string>;

/** Text with its [blanks] shown as boxes you type into. */
function Fillable({ text, fills, onFill }: { text: string; fills: Fills; onFill: (blank: string, value: string) => void }) {
  return (
    <>
      {splitBlanks(text).map((part, i) =>
        'text' in part ? (
          <span key={i}>{part.text}</span>
        ) : (
          <input
            key={i}
            class="blank"
            value={fills[part.blank] ?? ''}
            placeholder={part.blank}
            aria-label={part.blank}
            size={Math.max(part.blank.length, (fills[part.blank] ?? '').length, 6)}
            onInput={(e) => onFill(part.blank, (e.target as HTMLInputElement).value)}
          />
        ),
      )}
    </>
  );
}

function BlockView({ block, fills, onFill }: { block: Block; fills: Fills; onFill: (blank: string, value: string) => void }) {
  let n = 0;
  return (
    <div class="doc-block">
      {block.items.map((it) => {
        if (it.kind === 'heading') return <h4 key={it.id}>{it.text}</h4>;
        if (it.kind === 'analytic') {
          if (!it.text.trim()) return null;
          n++;
          return (
            <p key={it.id} class="doc-analytic">
              <span class="item-num">{n}.</span> <Fillable text={it.text} fills={fills} onFill={onFill} />
            </p>
          );
        }
        const card = db.cards.get(it.cardId);
        return card ? <CardBody key={it.id} card={card} side={highlightSide(card, block.side)} /> : null;
      })}
    </div>
  );
}

function TemplateView({ template, fills, onFill }: { template: BlockTemplate; fills: Fills; onFill: (blank: string, value: string) => void }) {
  return (
    <div class="doc-block">
      <p class="muted">{template.description}</p>
      {template.body.split('\n').map((line, i) => (
        <p key={i} class="doc-analytic">
          <Fillable text={line} fills={fills} onFill={onFill} />
        </p>
      ))}
    </div>
  );
}

function TFileView({ file }: { file: TFile }) {
  return (
    <div class="doc-block">
      {tFileToItems(file).slice(1).map((it, i) =>
        it.kind === 'card' ? (
          <CardBody key={i} card={it.card} side={it.side} />
        ) : it.kind === 'text' ? (
          <p key={i} class={it.bold ? 'doc-heading' : 'doc-analytic'}>
            {it.text}
          </p>
        ) : null,
      )}
    </div>
  );
}

export function roundDocSources(round: Round, onFills: (fills: Round['fills']) => void): RoundDocEntry[] {
  const out: RoundDocEntry[] = [];
  const fillsFor = (key: string): Fills => round.fills[key] ?? {};
  const setFill = (key: string) => (blank: string, value: string) => onFills({ ...round.fills, [key]: { ...fillsFor(key), [blank]: value } });

  for (const b of db.blocks.list.value) {
    if (b.topicId !== round.topicId) continue;
    const key = `block:${b.id}`;
    const cards = b.items.filter((it) => it.kind === 'card').length;
    out.push({
      key,
      type: 'block',
      title: blockTitle(b),
      sub: [b.speech === 'any' ? '' : b.speech, CATEGORY_LABEL[b.category], cards ? `${cards} card${cards === 1 ? '' : 's'}` : 'analytics'].filter(Boolean).join(' · '),
      side: b.side,
      fields: blockSearchFields(b),
      items: () => blockToItems(b, fillsFor(key)),
      render: () => <BlockView block={b} fills={fillsFor(key)} onFill={setFill(key)} />,
    });
  }

  // Templates are topic-independent text you own; in a round you fill the blanks by hand.
  for (const t of db.templates.list.value) {
    const key = `template:${t.id}`;
    out.push({
      key,
      type: 'block',
      title: `Template: ${t.title}`,
      sub: `${blanksOf(t.body).length} blanks to fill by hand`,
      side: t.side,
      fields: [
        { text: `${t.title} template`, weight: 6 },
        { text: `${t.description} ${t.body}`, weight: 1 },
      ],
      items: () => [
        { kind: 'heading', level: 3, text: t.title },
        { kind: 'text', text: fillBlanks(t.body, fillsFor(key)) },
      ],
      render: () => <TemplateView template={t} fills={fillsFor(key)} onFill={setFill(key)} />,
    });
  }

  for (const f of db.tfiles.list.value) {
    if (f.topicId !== round.topicId) continue;
    const def = db.cards.get(f.sections.find((s) => s.cardId)?.cardId);
    out.push({
      key: `tfile:${f.id}`,
      type: 'tfile',
      title: tFileTitle(f),
      sub: [f.type === 'shell' ? 'Neg shell' : 'Aff answers', def ? `def: ${cardShortCite(def) || tagText(def.tag).slice(0, 30)}` : '', `${f.sections.filter((s) => s.role === 'extension' && s.text.trim()).length} extensions`].filter(Boolean).join(' · '),
      side: tFileSide(f),
      fields: [...tFileSearchFields(f), { text: Object.values(ROLE_LABEL).join(' '), weight: 0.2 }],
      items: () => tFileToItems(f),
      render: () => <TFileView file={f} />,
    });
  }
  return out;
}
