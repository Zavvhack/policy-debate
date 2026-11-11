// Every kind of thing the app saves, in one place.
//
// The app stores plain JSON "documents" grouped into "collections" (cards,
// blocks, rounds, ...). If you add a field here, also think about old saved
// data that will not have it - see migrate() in src/core/backup/backup.ts.

import type { Side, SpeechId, TimeFormat } from '../core/debate/formats';
import type { FlowSheet } from '../core/flow/model';
import type { Abbreviation } from '../core/flow/abbrev';
import type { RoundClock } from '../core/timer/timer';

/** Bump this when the saved shape changes in a way old data needs converting for. */
export const SCHEMA_VERSION = 1;

export interface BaseDoc {
  id: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export interface NoviceCase {
  name: string;
  description: string;
}

export interface Topic extends BaseDoc {
  /** Short name shown in menus, e.g. "2026-27 National Health Insurance". */
  name: string;
  season: string;
  /** The exact resolution wording. The AI is always given this text. */
  resolution: string;
  /** Words and phrases of the resolution worth defining for topicality. */
  keyTerms: string[];
  noviceLimits: NoviceCase[];
  /** Anything worth knowing about the limits (who set them, caveats). */
  noviceNote: string;
  notes: string;
  sources: { label: string; url: string }[];
  /** True for the topic that ships with the app. You can still edit it. */
  builtIn?: boolean;
}

// ---------------------------------------------------------------------------
// Evidence cards
// ---------------------------------------------------------------------------

/**
 * How a piece of card text is formatted:
 *   0 = unread (small)
 *   1 = underlined, not read
 *   2 = highlighted (read aloud)
 *   3 = emphasis: highlighted, underlined and bold
 */
export type Level = 0 | 1 | 2 | 3;

/** A formatted stretch of the card: characters [s, e) are at level `lv`. Unmarked text is level 0. */
export interface Mark {
  s: number;
  e: number;
  lv: 1 | 2 | 3;
}

/** A piece of a tag. `u` = underlined. */
export interface TagPart {
  t: string;
  u?: boolean;
}

export interface Cite {
  first: string;
  last: string;
  /** Four-digit year, e.g. "2026". */
  year: string;
  /** Month/day, e.g. "1/28". */
  date: string;
  quals: string;
  title: string;
  publication: string;
  url: string;
  /** Date you accessed it (NSDA requires this for online evidence). */
  accessed: string;
  pages: string;
  /** The cutter's initials, shown as //AB at the end. */
  initials: string;
}

/** Where a card's text came from, so the verbatim check can be re-run at any time. */
export interface CardSourceRef {
  /** Id of a SourceDoc. */
  sourceId: string;
  /** The card text starts at this character of the source text. */
  start: number;
}

export type CardSide = Side | 'both';

export interface Card extends BaseDoc {
  topicId: string;
  kind: 'evidence' | 'definition';
  side: CardSide;
  tag: TagPart[];
  /** True while the tag is an AI draft you have not checked yet. */
  tagDraft: boolean;
  cite: Cite;
  /**
   * For imported cards: the cite exactly as it was written in the file. When
   * present it is shown and exported as-is instead of being rebuilt from `cite`,
   * so someone else's citation is never silently reformatted.
   */
  citeRaw?: { t: string; big?: boolean }[];
  /** Cite fields that could NOT be found in the source text and need checking by hand. */
  citeUnverified: string[];
  /** The card body: an exact copy of part of the source. Never edited after cutting. */
  text: string;
  marks: Mark[];
  /** Null for cards imported from a file, where there is no source to check against. */
  source: CardSourceRef | null;
  origin: 'cut' | 'import';
  /** True if the AI chose the highlighting. */
  aiMarked: boolean;
  /** Your own labels: the argument this card belongs to ("Econ DA", "States CP"...). */
  labels: string[];
  /** For definitions: the word or phrase being defined. */
  term: string;
  notes: string;
}

/** The full text of an article a card was cut from. */
export interface SourceDoc extends BaseDoc {
  topicId: string;
  kind: 'paste' | 'url' | 'pdf' | 'docx';
  /** File name, page title, or a short description. */
  name: string;
  url: string;
  text: string;
  /**
   * Citation details the page published about itself (title, author, date,
   * site). Kept so cite fields can be checked against them as well as the text.
   */
  meta: string;
}

// ---------------------------------------------------------------------------
// Blocks (your own analytical arguments)
// ---------------------------------------------------------------------------

export type BlockItem =
  | { id: string; kind: 'analytic'; text: string; /** AI-suggested and not yet checked by you. */ draft?: boolean }
  | { id: string; kind: 'card'; cardId: string }
  | { id: string; kind: 'heading'; text: string };

export type ArgCategory = 'case' | 'da' | 'cp' | 'k' | 't' | 'theory' | 'impact' | 'other';

export interface Block extends BaseDoc {
  topicId: string;
  title: string;
  side: Side;
  /** The speech it is written for, or 'any'. */
  speech: SpeechId | 'any';
  category: ArgCategory;
  /** The argument this block answers or extends, e.g. "Econ DA". */
  answersTo: string;
  items: BlockItem[];
  labels: string[];
  notes: string;
}

/** A fill-in-the-blank block you own. Blanks are written [like this]. */
export interface BlockTemplate extends BaseDoc {
  title: string;
  description: string;
  side: Side | 'both';
  category: ArgCategory;
  body: string;
  builtIn?: boolean;
}

// ---------------------------------------------------------------------------
// Topicality files
// ---------------------------------------------------------------------------

export type TSectionRole =
  | 'interp'
  | 'violation'
  | 'standard'
  | 'voter'
  | 'we-meet'
  | 'counter-interp'
  | 'reasonability'
  | 'offense'
  | 'extension';

export interface TSection {
  id: string;
  role: TSectionRole;
  /** e.g. "Limits", "Ground", "2NR overview". */
  title: string;
  text: string;
  /** A definition card that backs up an interpretation. */
  cardId?: string;
  /** For extensions: which speech it is for. */
  speech?: SpeechId;
  /** Unticked sections stay in the file but are left out when you read or export it. */
  on: boolean;
  /** AI-suggested and not yet checked by you. */
  draft?: boolean;
}

export interface TFile extends BaseDoc {
  topicId: string;
  /** 'shell' = the negative's T argument; 'answers' = the affirmative's answers. */
  type: 'shell' | 'answers';
  title: string;
  /** The word or phrase of the resolution in question. */
  term: string;
  /** The plan or case this is about (optional). */
  about: string;
  sections: TSection[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export interface RoundMeta {
  tournament: string;
  roundNumber: string;
  /** Which side YOU are on. */
  side: Side;
  opponent: string;
  judge: string;
  room: string;
}

export interface Round extends BaseDoc {
  topicId: string;
  name: string;
  meta: RoundMeta;
  /** A practice round behaves exactly like a real one (AI off) but is labelled. */
  practice: boolean;
  /** 'active' while Round Mode is on. */
  status: 'active' | 'finished';
  startedAt: number;
  endedAt: number | null;
  /** The time limits used (copied in, so later edits to presets do not change old rounds). */
  format: TimeFormat;
  mergeBlock: boolean;
  sheets: FlowSheet[];
  clock: RoundClock;
  /** Notes for each of the four cross-examinations, keyed by the speech questioned. */
  cxNotes: Record<string, string>;
  /** Blanks you filled in by hand during the round: fills[blockOrTemplateId][blank] = text. */
  fills: Record<string, Record<string, string>>;
  /** Post-round review. */
  result: '' | 'win' | 'loss';
  whatWorked: string;
  reviewNotes: string;
}

// ---------------------------------------------------------------------------
// Scouting
// ---------------------------------------------------------------------------

export interface ScoutTeam extends BaseDoc {
  type: 'team';
  topicId: string;
  school: string;
  code: string;
  debaters: string;
  /** Link to their openCaselist page. */
  wikiUrl: string;
  affNotes: string;
  negNotes: string;
  notes: string;
}

export interface ScoutJudge extends BaseDoc {
  type: 'judge';
  name: string;
  /** Link to their paradigm on Tabroom. */
  paradigmUrl: string;
  /** Your summary of their paradigm and what you have seen them vote on. */
  preferences: string;
  notes: string;
}

export interface ScoutTournament extends BaseDoc {
  type: 'tournament';
  topicId: string;
  name: string;
  dates: string;
  url: string;
  notes: string;
}

export type ScoutDoc = ScoutTeam | ScoutJudge | ScoutTournament;

// ---------------------------------------------------------------------------
// Practice drills
// ---------------------------------------------------------------------------

export interface Drill extends BaseDoc {
  topicId: string;
  kind: 't-2nr' | 't-2ar' | 'rebuttal-2nr' | 'rebuttal-2ar' | 'rebuttal-1ar' | 'other';
  title: string;
  /** What you were asked to do. */
  prompt: string;
  /** The round whose flow the drill is based on, if any. */
  roundId: string;
  /** Your speech, as typed. */
  response: string;
  /** AI feedback (Prep only). Always a draft opinion, never evidence. */
  feedback: string;
  seconds: number;
}

// ---------------------------------------------------------------------------
// Settings and small bits of app state
// ---------------------------------------------------------------------------

export type WordHighlight = 'yellow' | 'green' | 'cyan' | 'magenta' | 'red' | 'blue' | 'lightGray' | 'darkYellow';

export interface Settings {
  id: 'settings';
  theme: 'system' | 'light' | 'dark';
  /** 1 = normal size. */
  textScale: number;
  initials: string;
  activeTopicId: string;
  highlight: {
    /** 'custom' = soft colours (best for Google Docs); 'word' = Word's own highlighters (best for Verbatim). */
    mode: 'custom' | 'word';
    negColor: string;
    affColor: string;
    negWord: WordHighlight;
    affWord: WordHighlight;
    /** Point size of unread text. */
    unreadPt: number;
  };
  timer: {
    formatId: string;
    customFormats: TimeFormat[];
    /** Seconds before the end to warn at. 0 = no warning. */
    warningSec: number;
    sound: boolean;
    vibrate: boolean;
    flash: boolean;
  };
  flow: {
    mergeBlock: boolean;
    abbreviations: Abbreviation[];
    /** Flow text size in pixels. */
    fontPx: number;
    /** Show the automatic "probably dropped" hints. */
    dropHints: boolean;
  };
  ai: {
    /** Cheap, quick model for formatting jobs. */
    fastModel: string;
    /** Strongest model for strategy. */
    strongModel: string;
    /** Browser version only: keep the key after the tab closes. */
    rememberKey: boolean;
    /** False = AI buttons and AI-only pages are hidden completely (for people with no API key). */
    show: boolean;
  };
  /** True once the first-launch welcome has been seen. */
  seenWelcome: boolean;
  backup: {
    /** When you last saved a backup FILE (not the automatic in-app snapshots). */
    lastFileExportAt: number;
  };
}

/** The Round Mode lock, as saved. See src/ai/lock.ts. */
export interface LockDoc {
  id: 'roundLock';
  active: boolean;
  roundId: string | null;
  since: number | null;
}

/** Something you deleted, kept for a while so it can be restored. */
export interface TrashDoc {
  id: string;
  collection: CollectionName;
  deletedAt: number;
  label: string;
  doc: BaseDoc;
}

/** An automatic snapshot of everything, kept inside the app. */
export interface BackupDoc {
  id: string;
  createdAt: number;
  reason: string;
  /** JSON text of a Snapshot. */
  json: string;
  bytes: number;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/** The collections that hold your work. Each is one IndexedDB object store. */
export const DATA_COLLECTIONS = [
  'topics',
  'cards',
  'sources',
  'blocks',
  'templates',
  'tfiles',
  'rounds',
  'scouting',
  'drills',
] as const;

/** Housekeeping stores. `meta` holds settings and the lock. */
export const SYSTEM_COLLECTIONS = ['meta', 'trash', 'backups'] as const;

export const ALL_COLLECTIONS = [...DATA_COLLECTIONS, ...SYSTEM_COLLECTIONS] as const;

export type DataCollectionName = (typeof DATA_COLLECTIONS)[number];
export type CollectionName = (typeof ALL_COLLECTIONS)[number];

export interface CollectionTypes {
  topics: Topic;
  cards: Card;
  sources: SourceDoc;
  blocks: Block;
  templates: BlockTemplate;
  tfiles: TFile;
  rounds: Round;
  scouting: ScoutDoc;
  drills: Drill;
}

/** Everything in the app as one object: what a backup file contains. */
export interface Snapshot {
  app: 'policy-debate';
  schema: number;
  exportedAt: number;
  appVersion: string;
  settings: Settings | null;
  data: { [K in DataCollectionName]: CollectionTypes[K][] };
}
