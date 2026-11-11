// Blocks and T files as documents: for export, copying, searching, and reading.

import { fillBlanks } from '../../core/blocks/templates';
import type { DocItem } from '../../core/docx/write';
import type { SearchField } from '../../core/search';
import { tagText } from '../../core/cards/text';
import { newId, now } from '../../core/ids';
import { activeTopic, db } from '../../data/store';
import type { ArgCategory, Block, BlockItem, BlockTemplate, TFile, TSection, TSectionRole } from '../../data/schema';
import type { Side, SpeechId } from '../../core/debate/formats';
import { highlightSide } from '../cards/cardService';

export const CATEGORY_LABEL: Record<ArgCategory, string> = {
  case: 'Case',
  da: 'Disadvantage',
  cp: 'Counterplan',
  k: 'Kritik',
  t: 'Topicality',
  theory: 'Theory',
  impact: 'Impact calculus',
  other: 'General',
};

export function newBlock(patch: Partial<Block> = {}): Block {
  const t = now();
  return {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    topicId: activeTopic()?.id ?? '',
    title: '',
    side: 'aff',
    speech: 'any',
    category: 'other',
    answersTo: '',
    items: [{ id: newId(), kind: 'analytic', text: '' }],
    labels: [],
    notes: '',
    ...patch,
  };
}

export function blockTitle(b: Block): string {
  if (b.title.trim()) return b.title.trim();
  const speech = b.speech === 'any' ? '' : `${b.speech} `;
  return b.answersTo.trim() ? `${speech}${b.side === 'aff' ? 'Aff' : 'Neg'}: ${b.answersTo.trim()}` : 'Untitled block';
}

/**
 * A block as export items. Your own points are numbered and written as plain
 * text; cards are full cards. The two are never blended: a card's text is
 * always inside its own card, under its own tag and cite.
 * @param fills values for [blanks], when the block is being read in a round
 */
export function blockToItems(block: Block, fills?: Record<string, string>): DocItem[] {
  const items: DocItem[] = [{ kind: 'heading', level: 3, text: blockTitle(block) }];
  let n = 0;
  for (const it of block.items) {
    if (it.kind === 'heading') {
      items.push({ kind: 'text', text: it.text, bold: true });
    } else if (it.kind === 'analytic') {
      if (!it.text.trim()) continue;
      n++;
      items.push({ kind: 'text', text: `${n}. ${fillBlanks(it.text.trim(), fills)}` });
    } else {
      const card = db.cards.get(it.cardId);
      if (card) items.push({ kind: 'card', card, side: highlightSide(card, block.side) });
    }
  }
  return items;
}

export function blockSearchFields(b: Block): SearchField[] {
  const text = b.items
    .map((it) => (it.kind === 'card' ? tagText(db.cards.get(it.cardId)?.tag ?? []) : it.text))
    .join('\n');
  return [
    { text: `${blockTitle(b)} ${b.answersTo}`, weight: 6 },
    { text: `${b.labels.join(' ')} ${CATEGORY_LABEL[b.category]} ${b.speech}`, weight: 3 },
    { text: `${text} ${b.notes}`, weight: 1 },
  ];
}

export function blockFromTemplate(t: BlockTemplate, fills: Record<string, string>, patch: Partial<Block> = {}): Block {
  return newBlock({
    title: t.title,
    side: t.side === 'both' ? 'aff' : t.side,
    category: t.category,
    // One point per line of the template, with whatever has been filled in so far.
    items: fillBlanks(t.body, fills)
      .split('\n')
      .filter((l) => l.trim())
      .map((line): BlockItem => ({ id: newId(), kind: 'analytic', text: line.replace(/^\d+[.)]\s*/, '') })),
    ...patch,
  });
}

// ---------------------------------------------------------------------------
// Topicality files
// ---------------------------------------------------------------------------

export const ROLE_LABEL: Record<TSectionRole, string> = {
  interp: 'Interpretation',
  violation: 'Violation',
  standard: 'Standards',
  voter: 'Voters',
  'we-meet': 'We meet',
  'counter-interp': 'Counter-interpretation',
  reasonability: 'Reasonability vs. competing interpretations',
  offense: 'Offense against their standards',
  extension: 'Extensions',
};

export const SHELL_ROLES: TSectionRole[] = ['interp', 'violation', 'standard', 'voter', 'extension'];
export const ANSWER_ROLES: TSectionRole[] = ['we-meet', 'counter-interp', 'reasonability', 'offense', 'extension'];

const section = (role: TSectionRole, title: string, text = '', speech?: SpeechId): TSection => ({ id: newId(), role, title, text, on: true, ...(speech ? { speech } : {}) });

/** A new shell or answers file with the standard parts laid out, ready to fill in. */
export function newTFile(type: TFile['type'], term: string): TFile {
  const t = now();
  const sections =
    type === 'shell'
      ? [
          section('interp', 'Interpretation'),
          section('violation', 'Violation'),
          section('standard', 'Limits'),
          section('standard', 'Ground'),
          section('standard', 'Predictability / precision'),
          section('voter', 'Fairness'),
          section('voter', 'Education'),
        ]
      : [section('we-meet', 'We meet'), section('counter-interp', 'Counter-interpretation'), section('reasonability', 'Reasonability'), section('offense', 'Their interpretation overlimits')];
  return { id: newId(), createdAt: t, updatedAt: t, topicId: activeTopic()?.id ?? '', type, title: '', term, about: '', sections, notes: '' };
}

export function tFileTitle(f: TFile): string {
  if (f.title.trim()) return f.title.trim();
  return `${f.type === 'shell' ? 'T' : 'T answers'}: ${f.term.trim() || 'untitled'}${f.about.trim() ? ` (vs ${f.about.trim()})` : ''}`;
}

export function tFileSide(f: TFile): Side {
  return f.type === 'shell' ? 'neg' : 'aff';
}

/**
 * A T file as export items. Sections that are switched off are left out.
 * @param only limit to certain roles (e.g. just the shell without extensions)
 */
export function tFileToItems(f: TFile, only?: (s: TSection) => boolean): DocItem[] {
  const items: DocItem[] = [{ kind: 'heading', level: 3, text: tFileTitle(f) }];
  const side = tFileSide(f);
  const letters = 'ABCDEFGHIJ';
  let letter = 0;
  for (const role of f.type === 'shell' ? SHELL_ROLES : ANSWER_ROLES) {
    const secs = f.sections.filter((s) => s.role === role && s.on && (s.text.trim() || s.cardId) && (!only || only(s)));
    if (!secs.length) continue;
    if (role === 'extension') {
      for (const s of secs) {
        items.push({ kind: 'text', text: `${s.speech ?? ''} ${s.title || 'Extension'}`.trim(), bold: true });
        if (s.text.trim()) items.push({ kind: 'text', text: s.text.trim() });
      }
      continue;
    }
    items.push({ kind: 'text', text: `${letters[letter++] ?? '-'}. ${ROLE_LABEL[role]}`, bold: true });
    secs.forEach((s, i) => {
      const label = secs.length > 1 || (s.title && s.title !== ROLE_LABEL[role]) ? `${secs.length > 1 ? `${i + 1}. ` : ''}${s.title ? `${s.title}: ` : ''}` : '';
      if (s.text.trim()) items.push({ kind: 'text', text: `${label}${s.text.trim()}` });
      const card = db.cards.get(s.cardId);
      if (card) items.push({ kind: 'card', card, side: highlightSide(card, side) });
    });
  }
  return items;
}

export function tFileSearchFields(f: TFile): SearchField[] {
  return [
    { text: `${tFileTitle(f)} ${f.term} topicality`, weight: 6 },
    { text: f.about, weight: 3 },
    { text: `${f.sections.map((s) => `${s.title} ${s.text}`).join('\n')} ${f.notes}`, weight: 1 },
  ];
}

/** The file as plain text (given to the AI in Prep, and used for drills). */
export function tFileToText(f: TFile): string {
  return tFileToItems(f)
    .map((it) => (it.kind === 'card' ? `[Card] ${tagText(it.card.tag)}\n${it.card.text}` : it.text))
    .join('\n');
}
