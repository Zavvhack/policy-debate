// Making saved data safe to show.
//
// Everything the app reads back (from its own database, from a backup file, or
// from the crash journal) passes through repairDoc() first. Data can be
// incomplete for honest reasons: it was saved by an older version of the app
// that did not have a field yet, a write was cut off, or a backup file was
// edited by hand. The screens assume every field exists, so a missing list
// would otherwise crash them.
//
// Two rules:
//  1. Fill in what is missing with an empty value. Never invent content.
//  2. NEVER touch the words of a card or a source. If a card's text is not
//     text at all, the card is dropped rather than "fixed": evidence must be
//     exactly what was saved, or absent.

import { BUILT_IN_FORMATS, ROUND_STEPS, SPEECHES, type SpeechId, type TimeFormat } from '../debate/formats';
import { repairSheet } from '../flow/model';
import { createCountdown, createRoundClock, type Countdown, type RoundClock } from '../timer/timer';
import type {
  BaseDoc,
  Block,
  BlockItem,
  BlockTemplate,
  Card,
  Cite,
  DataCollectionName,
  Drill,
  Mark,
  Round,
  ScoutDoc,
  SourceDoc,
  TFile,
  Topic,
  TSection,
} from '../../data/schema';

type Raw = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown): boolean => v === true;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === 'string');
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

const CITE_FIELDS: (keyof Cite)[] = ['first', 'last', 'year', 'date', 'quals', 'title', 'publication', 'url', 'accessed', 'pages', 'initials'];
const ARG_CATEGORIES = ['case', 'da', 'cp', 'k', 't', 'theory', 'impact', 'other'] as const;
const T_ROLES = ['interp', 'violation', 'standard', 'voter', 'we-meet', 'counter-interp', 'reasonability', 'offense', 'extension'] as const;

function base(d: Raw): BaseDoc {
  return { id: str(d.id), createdAt: num(d.createdAt), updatedAt: num(d.updatedAt) };
}

function repairTopic(d: Raw): Topic {
  return {
    ...(d as unknown as Topic),
    ...base(d),
    name: str(d.name, 'Topic'),
    season: str(d.season),
    resolution: str(d.resolution),
    keyTerms: strings(d.keyTerms),
    noviceLimits: list(d.noviceLimits)
      .filter(isObj)
      .map((n) => ({ name: str(n.name), description: str(n.description) })),
    noviceNote: str(d.noviceNote),
    notes: str(d.notes),
    sources: list(d.sources)
      .filter(isObj)
      .map((x) => ({ label: str(x.label), url: str(x.url) })),
  };
}

/** Keep only highlight marks that point inside the text. The text itself is never changed. */
function repairMarks(v: unknown, length: number): Mark[] {
  const out: Mark[] = [];
  for (const m of list(v)) {
    if (!isObj(m)) continue;
    const s = num(m.s, -1);
    const e = num(m.e, -1);
    const lv = m.lv;
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s || e > length) continue;
    if (lv !== 1 && lv !== 2 && lv !== 3) continue;
    out.push({ s, e, lv });
  }
  return out;
}

function repairCard(d: Raw): Card | null {
  // The evidence itself must be there, exactly as saved. If it is not text, there is no card.
  if (typeof d.text !== 'string') return null;
  const cite = isObj(d.cite) ? d.cite : {};
  const fixedCite = {} as Cite;
  for (const f of CITE_FIELDS) fixedCite[f] = str(cite[f]);
  const source = isObj(d.source) && typeof d.source.sourceId === 'string' ? { sourceId: d.source.sourceId, start: num(d.source.start) } : null;
  const citeRaw = Array.isArray(d.citeRaw)
    ? d.citeRaw.filter(isObj).map((p) => (p.big === true ? { t: str(p.t), big: true } : { t: str(p.t) }))
    : undefined;
  const card: Card = {
    ...(d as unknown as Card),
    ...base(d),
    topicId: str(d.topicId),
    kind: oneOf(d.kind, ['evidence', 'definition'] as const, 'evidence'),
    side: oneOf(d.side, ['aff', 'neg', 'both'] as const, 'neg'),
    tag: list(d.tag)
      .filter(isObj)
      .map((p) => (p.u === true ? { t: str(p.t), u: true } : { t: str(p.t) })),
    tagDraft: bool(d.tagDraft),
    cite: fixedCite,
    citeUnverified: strings(d.citeUnverified),
    text: d.text,
    marks: repairMarks(d.marks, d.text.length),
    source,
    origin: oneOf(d.origin, ['cut', 'import'] as const, 'import'),
    aiMarked: bool(d.aiMarked),
    labels: strings(d.labels),
    term: str(d.term),
    notes: str(d.notes),
  };
  if (citeRaw) card.citeRaw = citeRaw;
  else delete card.citeRaw;
  return card;
}

function repairSource(d: Raw): SourceDoc | null {
  if (typeof d.text !== 'string') return null; // same rule as cards: the words are kept exactly or not at all
  return {
    ...(d as unknown as SourceDoc),
    ...base(d),
    topicId: str(d.topicId),
    kind: oneOf(d.kind, ['paste', 'url', 'pdf', 'docx'] as const, 'paste'),
    name: str(d.name, 'Source'),
    url: str(d.url),
    text: d.text,
    meta: str(d.meta),
  };
}

function repairBlockItems(v: unknown): BlockItem[] {
  const out: BlockItem[] = [];
  for (const it of list(v)) {
    if (!isObj(it) || typeof it.id !== 'string') continue;
    if (it.kind === 'card' && typeof it.cardId === 'string') out.push({ id: it.id, kind: 'card', cardId: it.cardId });
    else if (it.kind === 'heading') out.push({ id: it.id, kind: 'heading', text: str(it.text) });
    else if (it.kind === 'analytic') out.push(it.draft === true ? { id: it.id, kind: 'analytic', text: str(it.text), draft: true } : { id: it.id, kind: 'analytic', text: str(it.text) });
  }
  return out;
}

function repairBlock(d: Raw): Block {
  return {
    ...(d as unknown as Block),
    ...base(d),
    topicId: str(d.topicId),
    title: str(d.title),
    side: oneOf(d.side, ['aff', 'neg'] as const, 'neg'),
    speech: oneOf(d.speech, [...SPEECHES, 'any'] as const, 'any'),
    category: oneOf(d.category, ARG_CATEGORIES, 'other'),
    answersTo: str(d.answersTo),
    items: repairBlockItems(d.items),
    labels: strings(d.labels),
    notes: str(d.notes),
  };
}

function repairTemplate(d: Raw): BlockTemplate {
  return {
    ...(d as unknown as BlockTemplate),
    ...base(d),
    title: str(d.title, 'Template'),
    description: str(d.description),
    side: oneOf(d.side, ['aff', 'neg', 'both'] as const, 'both'),
    category: oneOf(d.category, ARG_CATEGORIES, 'other'),
    body: str(d.body),
  };
}

function repairTFile(d: Raw): TFile {
  const sections: TSection[] = [];
  for (const sec of list(d.sections)) {
    if (!isObj(sec) || typeof sec.id !== 'string') continue;
    const fixed: TSection = {
      ...(sec as unknown as TSection),
      id: sec.id,
      role: oneOf(sec.role, T_ROLES, 'standard'),
      title: str(sec.title),
      text: str(sec.text),
      on: sec.on !== false,
    };
    if (typeof sec.cardId !== 'string') delete fixed.cardId;
    if (!SPEECHES.includes(sec.speech as SpeechId)) delete fixed.speech;
    sections.push(fixed);
  }
  return {
    ...(d as unknown as TFile),
    ...base(d),
    topicId: str(d.topicId),
    type: oneOf(d.type, ['shell', 'answers'] as const, 'shell'),
    title: str(d.title),
    term: str(d.term),
    about: str(d.about),
    sections,
    notes: str(d.notes),
  };
}

function repairFormat(v: unknown): TimeFormat {
  const fallback = BUILT_IN_FORMATS[0];
  if (!isObj(v)) return { ...fallback };
  const secs = (x: unknown, d: number) => {
    const n = num(x, d);
    return n > 0 ? n : d;
  };
  return {
    ...(v as unknown as TimeFormat),
    id: str(v.id, fallback.id),
    name: str(v.name, fallback.name),
    constructive: secs(v.constructive, fallback.constructive),
    cx: secs(v.cx, fallback.cx),
    rebuttal: secs(v.rebuttal, fallback.rebuttal),
    prep: secs(v.prep, fallback.prep),
  };
}

function repairCountdown(v: unknown, fallbackMs: number): Countdown {
  if (!isObj(v)) return createCountdown(fallbackMs);
  const durationMs = Math.max(0, num(v.durationMs, fallbackMs));
  const startedAt = typeof v.startedAt === 'number' && Number.isFinite(v.startedAt) ? v.startedAt : null;
  // A timer can only be "running" if we know when it started.
  const running = v.running === true && startedAt !== null;
  return { durationMs, remainingMs: num(v.remainingMs, durationMs), running, startedAt: running ? startedAt : null };
}

function repairClock(v: unknown, format: TimeFormat): RoundClock {
  const fresh = createRoundClock(format);
  if (!isObj(v)) return fresh;
  const stepIndex = Math.min(ROUND_STEPS.length - 1, Math.max(0, Math.floor(num(v.stepIndex, 0))));
  const prep = isObj(v.prep) ? v.prep : {};
  return {
    stepIndex,
    speech: repairCountdown(v.speech, fresh.speech.durationMs),
    prep: { aff: repairCountdown(prep.aff, format.prep * 1000), neg: repairCountdown(prep.neg, format.prep * 1000) },
  };
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return out;
}

/** Make sure a loaded round has every field the app expects. */
export function repairRound(input: Round): Round {
  const d = input as unknown as Raw;
  const format = repairFormat(d.format);
  const meta = isObj(d.meta) ? d.meta : {};
  const fills: Record<string, Record<string, string>> = {};
  if (isObj(d.fills)) for (const [k, v] of Object.entries(d.fills)) fills[k] = stringMap(v);
  const startedAt = num(d.startedAt, num(d.createdAt));
  return {
    ...input,
    ...base(d),
    topicId: str(d.topicId),
    name: str(d.name, 'Round'),
    meta: {
      tournament: str(meta.tournament),
      roundNumber: str(meta.roundNumber),
      side: oneOf(meta.side, ['aff', 'neg'] as const, 'neg'),
      opponent: str(meta.opponent),
      judge: str(meta.judge),
      room: str(meta.room),
    },
    practice: bool(d.practice),
    status: oneOf(d.status, ['active', 'finished'] as const, 'finished'),
    startedAt,
    endedAt: typeof d.endedAt === 'number' && Number.isFinite(d.endedAt) ? d.endedAt : null,
    format,
    mergeBlock: bool(d.mergeBlock),
    sheets: list(d.sheets)
      .filter(isObj)
      .map((s) => repairSheet(s as unknown as Parameters<typeof repairSheet>[0])),
    clock: repairClock(d.clock, format),
    cxNotes: stringMap(d.cxNotes),
    fills,
    result: oneOf(d.result, ['', 'win', 'loss'] as const, ''),
    whatWorked: str(d.whatWorked),
    reviewNotes: str(d.reviewNotes),
  };
}

function repairScout(d: Raw): ScoutDoc | null {
  if (d.type === 'team') {
    return {
      ...(d as unknown as ScoutDoc & { type: 'team' }),
      ...base(d),
      type: 'team',
      topicId: str(d.topicId),
      school: str(d.school),
      code: str(d.code),
      debaters: str(d.debaters),
      wikiUrl: str(d.wikiUrl),
      affNotes: str(d.affNotes),
      negNotes: str(d.negNotes),
      notes: str(d.notes),
    };
  }
  if (d.type === 'judge') {
    return { ...(d as unknown as ScoutDoc & { type: 'judge' }), ...base(d), type: 'judge', name: str(d.name), paradigmUrl: str(d.paradigmUrl), preferences: str(d.preferences), notes: str(d.notes) };
  }
  if (d.type === 'tournament') {
    return {
      ...(d as unknown as ScoutDoc & { type: 'tournament' }),
      ...base(d),
      type: 'tournament',
      topicId: str(d.topicId),
      name: str(d.name),
      dates: str(d.dates),
      url: str(d.url),
      notes: str(d.notes),
    };
  }
  return null;
}

function repairDrill(d: Raw): Drill {
  return {
    ...(d as unknown as Drill),
    ...base(d),
    topicId: str(d.topicId),
    kind: oneOf(d.kind, ['t-2nr', 't-2ar', 'rebuttal-2nr', 'rebuttal-2ar', 'rebuttal-1ar', 'other'] as const, 'other'),
    title: str(d.title),
    prompt: str(d.prompt),
    roundId: str(d.roundId),
    response: str(d.response),
    feedback: str(d.feedback),
    seconds: Math.max(0, num(d.seconds)),
  };
}

/**
 * Check one saved document and fill in anything missing.
 * Returns null if it cannot be used at all (no id, or a card with no text).
 */
export function repairDoc(collection: DataCollectionName, input: unknown): BaseDoc | null {
  if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
  try {
    switch (collection) {
      case 'topics':
        return repairTopic(input);
      case 'cards':
        return repairCard(input);
      case 'sources':
        return repairSource(input);
      case 'blocks':
        return repairBlock(input);
      case 'templates':
        return repairTemplate(input);
      case 'tfiles':
        return repairTFile(input);
      case 'rounds':
        return repairRound(input as unknown as Round);
      case 'scouting':
        return repairScout(input);
      case 'drills':
        return repairDrill(input);
    }
  } catch {
    return null;
  }
}

/** Repair a whole list, dropping what cannot be used and anything with a repeated id. */
export function repairList(collection: DataCollectionName, input: unknown): { docs: BaseDoc[]; dropped: number } {
  const seen = new Set<string>();
  const docs: BaseDoc[] = [];
  let dropped = 0;
  for (const item of list(input)) {
    const doc = repairDoc(collection, item);
    if (!doc || seen.has(doc.id)) {
      dropped++;
      continue;
    }
    seen.add(doc.id);
    docs.push(doc);
  }
  return { docs, dropped };
}
