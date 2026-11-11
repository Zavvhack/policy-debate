// Creating, checking, importing and exporting cards.

import { citeToText, emptyCite, shortCite, unverifiedCiteFields } from '../../core/cards/cite';
import { parseTagMarkup, tagText } from '../../core/cards/text';
import { verifyCard, verifyText, type Cut, type VerifyResult } from '../../core/cards/verify';
import type { Side } from '../../core/debate/formats';
import { extractCards, readDocx, type ImportedFile } from '../../core/docx/read';
import { buildDocx, DOCX_MIME, type DocItem } from '../../core/docx/write';
import { copyRich, itemsToHtml, itemsToPlainText } from '../../core/export/html';
import { newId, now, safeFileName } from '../../core/ids';
import type { SearchField } from '../../core/search';
import { activeTopic, db, settings } from '../../data/store';
import type { Card, CardSide, Cite, SourceDoc, TagPart } from '../../data/schema';
import { platform } from '../../platform';
import { toast } from '../../ui/kit';

/** Save a source's text, reusing an existing copy if the exact same text is already on file. */
export function ensureSource(input: Pick<SourceDoc, 'kind' | 'name' | 'url' | 'text' | 'meta'>): SourceDoc {
  const topicId = activeTopic()?.id ?? '';
  const existing = db.sources.list.value.find((s) => s.topicId === topicId && s.text === input.text);
  if (existing) return existing;
  const t = now();
  return db.sources.put({ id: newId(), createdAt: t, updatedAt: t, topicId, ...input });
}

export interface NewCardInput {
  cut: Cut;
  source: SourceDoc;
  side: CardSide;
  tag: TagPart[];
  tagDraft: boolean;
  cite: Cite;
  citeUnverified: string[];
  labels: string[];
  kind: Card['kind'];
  term: string;
  aiMarked: boolean;
}

export function createCard(input: NewCardInput): Card {
  const t = now();
  return db.cards.put({
    id: newId(),
    createdAt: t,
    updatedAt: t,
    topicId: input.source.topicId || activeTopic()?.id || '',
    kind: input.kind,
    side: input.side,
    tag: input.tag,
    tagDraft: input.tagDraft,
    cite: input.cite,
    citeUnverified: input.citeUnverified,
    text: input.cut.text,
    marks: input.cut.marks,
    source: { sourceId: input.source.id, start: input.cut.start },
    origin: 'cut',
    aiMarked: input.aiMarked,
    labels: input.labels,
    term: input.term,
    notes: '',
  });
}

/** Everything needed to turn a cut into a saved card. */
export interface CutContext {
  draft: Pick<SourceDoc, 'kind' | 'name' | 'url' | 'text' | 'meta'>;
  cite: Cite;
  side: CardSide;
  kind: Card['kind'];
  term: string;
  labels: string[];
  /** The debater's own tag, in [[markup]] form. */
  tag: string;
}

export type CutExtra = Partial<Pick<Card, 'tag' | 'tagDraft' | 'aiMarked'>> & { cite?: Cite; citeUnverified?: string[] };

/**
 * Check a cut against its source and, if it passes, save it as a card.
 * Every card in the app is created here, whether it was cut by hand or with AI.
 * Returns the reason as a string if the cut is rejected.
 */
export function saveCut(ctx: CutContext, cut: Cut, extra: CutExtra = {}): Card | string {
  const check = verifyText(cut.text, cut.start, ctx.draft.text);
  if (check.status !== 'verified') return check.errors.join(' ') || 'The text does not match the source.';
  const source = ensureSource({ kind: ctx.draft.kind, name: ctx.draft.name || ctx.cite.title || 'Pasted text', url: ctx.draft.url || ctx.cite.url, text: ctx.draft.text, meta: ctx.draft.meta });
  const cite = extra.cite ?? ctx.cite;
  return createCard({
    cut,
    source,
    side: ctx.side,
    tag: extra.tag ?? parseTagMarkup(ctx.tag.trim()),
    tagDraft: extra.tagDraft ?? false,
    cite: { ...cite, initials: cite.initials.trim() || settings.value.initials },
    citeUnverified: extra.citeUnverified ?? unverifiedCiteFields(cite, ctx.draft.text, ctx.draft.meta),
    labels: ctx.labels,
    kind: ctx.kind,
    term: ctx.kind === 'definition' ? ctx.term.trim() : '',
    aiMarked: extra.aiMarked ?? false,
  });
}

/** Run the verbatim check on a saved card. */
export function checkCard(card: Card): VerifyResult {
  return verifyCard(card, card.source ? db.sources.get(card.source.sourceId) : null);
}

/** Which highlight colour a card gets: the context's side if given, else the card's own. */
export function highlightSide(card: Pick<Card, 'side'>, context?: Side): Side {
  return context ?? (card.side === 'aff' ? 'aff' : 'neg');
}

/** "Okafor 26" for a card, falling back to the imported cite's opening words. */
export function cardShortCite(card: Card): string {
  const short = shortCite(card.cite);
  if (short) return short;
  return (card.citeRaw ?? []).map((p) => p.t).join('').trim().slice(0, 40);
}

export function cardCiteText(card: Card): string {
  return card.citeRaw?.length ? card.citeRaw.map((p) => p.t).join('') : citeToText(card.cite);
}

export function cardSearchFields(card: Card): SearchField[] {
  return [
    { text: tagText(card.tag), weight: 6 },
    { text: `${cardCiteText(card)} ${card.labels.join(' ')} ${card.term}`, weight: 4 },
    { text: card.notes, weight: 2 },
    { text: card.text, weight: 1 },
  ];
}

export function cardsToItems(cards: readonly Card[], context?: Side): DocItem[] {
  return cards.map((card) => ({ kind: 'card', card, side: highlightSide(card, context) }));
}

export async function downloadDocx(name: string, items: readonly DocItem[]): Promise<void> {
  try {
    const bytes = await buildDocx(items, settings.value.highlight);
    const ok = await platform.saveFile(`${safeFileName(name, 'cards')}.docx`, new Blob([bytes as BlobPart], { type: DOCX_MIME }));
    if (ok) toast('Saved the .docx file.', { kind: 'success' });
  } catch (err) {
    toast(`Could not make the .docx: ${err instanceof Error ? err.message : err}`, { kind: 'error' });
  }
}

export async function copyItems(items: readonly DocItem[]): Promise<void> {
  const ok = await copyRich(itemsToHtml(items, settings.value.highlight), itemsToPlainText(items));
  toast(ok ? 'Copied. Paste it into Google Docs or Word.' : 'Copying was blocked here. Use "Download .docx" instead.', { kind: ok ? 'success' : 'error' });
}

/** Read an evidence file (.docx). Nothing is saved yet. */
export async function readEvidenceFile(file: File): Promise<ImportedFile> {
  return extractCards(await readDocx(await file.arrayBuffer()));
}

/** Save the cards of an imported evidence file to the library. Returns how many were added. */
export function saveImportedCards(file: ImportedFile, side: CardSide, extraLabels: string[]): Card[] {
  const topicId = activeTopic()?.id ?? '';
  const t = now();
  return file.cards.map((c, i) =>
    db.cards.put({
      id: newId(),
      createdAt: t + i, // keeps the file's order when sorted by date
      updatedAt: t + i,
      topicId,
      kind: 'evidence',
      side,
      tag: c.tag,
      tagDraft: false,
      cite: { ...emptyCite(), last: c.last, year: c.year },
      citeRaw: c.citeRaw,
      citeUnverified: [],
      text: c.text,
      marks: c.marks,
      source: null,
      origin: 'import',
      aiMarked: false,
      labels: [...new Set([...extraLabels, ...c.path.slice(-1)].map((l) => l.trim()).filter(Boolean))],
      term: '',
      notes: '',
    }),
  );
}

/** Every label used on the active topic's cards, most used first. */
export function knownLabels(): string[] {
  const topicId = activeTopic()?.id;
  const counts = new Map<string, number>();
  for (const c of db.cards.list.value) if (c.topicId === topicId) for (const l of c.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const b of db.blocks.list.value) if (b.topicId === topicId && b.answersTo.trim()) counts.set(b.answersTo.trim(), (counts.get(b.answersTo.trim()) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

export function parseLabels(text: string): string[] {
  return [...new Set(text.split(',').map((l) => l.trim()).filter(Boolean))];
}
