// Every AI job in the app, in one file: what is asked, and how the answer is
// checked before any of it reaches the screen.
//
// Ground rules built into every prompt AND enforced in code afterwards:
//   - AI never supplies evidence text. For cards it returns word numbers only.
//   - Cite details it suggests are looked up in the article; anything not found is dropped.
//   - Quotes in its feedback are looked up in what it was shown; made-up quotes are flagged.
//   - Everything it writes is a draft for the debater to check.
//
// All requests go through askClaude(), which is where the Round Mode lock lives.

import { applyWordPlan, numberWords, PlanError, planDensity, renderNumbered, validatePlan } from '../core/cards/cutter';
import { dropFields, emptyCite, unverifiedCiteFields } from '../core/cards/cite';
import { parseTagMarkup } from '../core/cards/text';
import { verifyText, type Cut } from '../core/cards/verify';
import { unverifiedQuotes } from '../core/ai/quotes';
import type { Cite, TagPart, Topic } from '../data/schema';
import { AiError, askClaude, type AiResult } from './client';

// ---------------------------------------------------------------------------
// Shared prompt pieces
// ---------------------------------------------------------------------------

/** The active topic, given to the model word for word in every request. */
export function topicBrief(topic: Topic | undefined): string {
  if (!topic) return 'No topic is set.';
  const lines = [`THE TOPIC (${topic.season || topic.name}), exact wording:`, topic.resolution];
  if (topic.keyTerms.length) lines.push(`Key terms: ${topic.keyTerms.join('; ')}`);
  if (topic.noviceLimits.length) lines.push(`Novice case limits: ${topic.noviceLimits.map((n) => n.name).join('; ')}`);
  if (topic.notes.trim()) lines.push(`Debater's notes on the topic: ${topic.notes.trim()}`);
  return lines.join('\n');
}

const COACH = `You are an experienced high school policy debate coach helping a student PREPARE before a tournament. You are never used during a round.

Rules you must follow:
- Never invent evidence. Do not make up quotes, authors, dates, qualifications, statistics, or study results. If you refer to evidence, refer only to text included in this request, and quote it exactly.
- Your arguments are analytical drafts in the student's voice. The student will check and rewrite them. Do not present your own claims as if a source said them.
- Base everything on the topic wording given. Do not assume a different resolution.
- Write the way debaters talk: short, numbered, line-by-line, each point a claim plus a warrant. No filler and no flattery.`;

function system(topic: Topic | undefined, extra = ''): string {
  return `${COACH}\n\n${topicBrief(topic)}${extra ? `\n\n${extra}` : ''}`;
}

const str = { type: 'string' } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items: unknown) => ({ type: 'array', items });

// ---------------------------------------------------------------------------
// 1. Cutting a card
// ---------------------------------------------------------------------------

export type Density = 'light' | 'medium' | 'heavy';

const DENSITY_TEXT: Record<Density, string> = {
  light: 'about 15-25% of the words in the card',
  medium: 'about 25-40% of the words in the card',
  heavy: 'about 40-55% of the words in the card',
};

export interface AiCutInput {
  source: string;
  /** Extra trusted text about the source (page metadata), used only for checking the cite. */
  meta: string;
  side: 'aff' | 'neg' | 'both';
  claim: string;
  /** The debater's own tag, if they wrote one. It is kept as written. */
  tag: string;
  density: Density;
  topic: Topic | undefined;
  /** For definitions: the word or phrase the card should define. */
  term?: string;
  signal?: AbortSignal;
}

export interface AiCutOutput {
  cut: Cut;
  tag: TagPart[];
  /** True if the tag came from the model. */
  tagDraft: boolean;
  /** Cite details found in the article. Only fields that could be verified are filled in. */
  cite: Cite;
  /** Cite fields the model suggested that were NOT in the article, and were thrown away. */
  citeDropped: (keyof Cite)[];
  /** Share of the card's words that are highlighted, 0-1. */
  density: number;
  usd: number;
  model: string;
}

const CUT_SCHEMA = obj({
  start: { type: 'integer' },
  end: { type: 'integer' },
  spans: list(obj({ from: { type: 'integer' }, to: { type: 'integer' }, level: { type: 'string', enum: ['u', 'h', 'e'] } })),
  tag: str,
  cite: obj({ first: str, last: str, year: str, date: str, quals: str, title: str, publication: str }),
});

export function cutPrompt(input: AiCutInput, numbered: string, wordCount: number, retryNote = ''): string {
  const sideName = input.side === 'aff' ? 'the AFFIRMATIVE' : input.side === 'neg' ? 'the NEGATIVE' : 'either side';
  return `Cut one evidence card for ${sideName} from the article below.

In the article, every word is followed by its number in angle marks, like this: Costs‹0› rose‹1› sharply.‹2›
There are ${wordCount} words, numbered 0 to ${wordCount - 1}. You choose words BY NUMBER ONLY. You never retype the article's text.
${input.term ? `\nThis card is a DEFINITION of "${input.term}" for a topicality argument. Choose the passage that actually defines or interprets that term.\n` : ''}${input.claim.trim() ? `\nThe debater wants the card to prove: ${input.claim.trim()}\n` : ''}${input.tag.trim() ? `\nThe debater already wrote the tag, so return "tag": "" and leave the tag to them.\n` : ''}
What to return:
1. "start" and "end": the first and last word numbers of the card. Pick the single best continuous passage, usually one to four paragraphs. Start at the beginning of a sentence and end at the end of a sentence. Include enough around the key claim that it is not taken out of context. Do not include bylines, headlines, captions or navigation text.
2. "spans": the formatting, as ranges of word numbers (inclusive) inside the card, each with a level:
   "u" = underlined: important context, not read aloud
   "h" = highlighted: the words the debater reads aloud
   "e" = emphasis: the one to four most important highlighted phrases (the impact, the key warrant, a number)
   Highlight ${DENSITY_TEXT[input.density]}. Read on their own, in order, the highlighted words must make grammatical sentences that say what the author means. Never skip a "not", "no", "never" or other word in a way that changes the meaning. Everything highlighted should sit inside underlined text.
3. "tag": ${input.tag.trim() ? 'an empty string.' : 'one punchy sentence, in debate style, stating the claim this card supports. Never claim more than the evidence says. Wrap one to three key phrases in [[double brackets]] to underline them.'}
4. "cite": details copied EXACTLY as they appear in the article text (author first and last name, four-digit year, date as month/day like 1/28, the author's qualifications in the article's own words, the title, the publication). Use "" for anything the article does not state. Do not guess and do not use outside knowledge.
${retryNote ? `\n${retryNote}\n` : ''}
ARTICLE:
${numbered}`;
}

/** Cut a card with AI. Throws AiError if no valid cut could be made. */
export async function aiCutCard(input: AiCutInput): Promise<AiCutOutput> {
  const words = numberWords(input.source);
  if (words.length < 30) throw new AiError('other', 'Paste more of the article first (at least a few sentences).');
  const numbered = renderNumbered(input.source, words);
  let usd = 0;
  let lastProblem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = attempt ? `Your previous answer could not be used: ${lastProblem} Answer again with valid word numbers.` : '';
    const res: AiResult<Record<string, unknown>> = await askClaude({
      task: 'Cut a card',
      tier: 'fast',
      effort: 'medium',
      system: system(input.topic),
      user: cutPrompt(input, numbered, words.length, retryNote),
      schema: CUT_SCHEMA,
      maxTokens: 6000,
      signal: input.signal,
    });
    usd += res.usd;
    try {
      const plan = validatePlan(res.data, words.length);
      // The card is built from the SOURCE, by position. Nothing the model wrote becomes card text.
      const cut = applyWordPlan(input.source, words, plan);
      const check = verifyText(cut.text, cut.start, input.source);
      if (check.status !== 'verified') throw new PlanError(check.errors.join(' '));

      const raw = (res.data?.cite ?? {}) as Partial<Record<keyof Cite, unknown>>;
      const suggested: Cite = { ...emptyCite() };
      for (const k of ['first', 'last', 'year', 'date', 'quals', 'title', 'publication'] as const) {
        if (typeof raw[k] === 'string') suggested[k] = (raw[k] as string).trim();
      }
      // Anything the model "found" that is not in the article is thrown away.
      const citeDropped = unverifiedCiteFields(suggested, input.source, input.meta);
      const ownTag = input.tag.trim();
      const aiTag = typeof res.data?.tag === 'string' ? res.data.tag.trim() : '';
      return {
        cut,
        tag: parseTagMarkup(ownTag || aiTag),
        tagDraft: !ownTag && !!aiTag,
        cite: dropFields(suggested, citeDropped),
        citeDropped,
        density: planDensity(plan),
        usd,
        model: res.model,
      };
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      lastProblem = err.message;
    }
  }
  throw new AiError('bad-output', `The AI could not produce a valid cut (${lastProblem}) Nothing was added. Try again, or cut this one by hand.`);
}

// ---------------------------------------------------------------------------
// 2. Tags
// ---------------------------------------------------------------------------

export async function aiSuggestTag(cardText: string, readText: string, side: string, topic: Topic | undefined, signal?: AbortSignal): Promise<{ tag: TagPart[]; usd: number }> {
  const res = await askClaude<{ tag: string }>({
    task: 'Suggest a tag',
    tier: 'fast',
    effort: 'low',
    system: system(topic),
    user: `Write a tag for this evidence card, for the ${side} side.

A tag is one punchy sentence stating the claim the card supports. It must not claim more than the evidence says. Wrap one to three key phrases in [[double brackets]].

THE CARD:
${cardText}

${readText ? `THE PART THAT IS READ ALOUD:\n${readText}` : ''}`,
    schema: obj({ tag: str }),
    maxTokens: 1000,
    signal,
  });
  return { tag: parseTagMarkup((res.data?.tag ?? '').trim()), usd: res.usd };
}

// ---------------------------------------------------------------------------
// 3. Blocks
// ---------------------------------------------------------------------------

export interface LibraryRef {
  id: string;
  tag: string;
  cite: string;
}

export interface BlockDraft {
  title: string;
  items: ({ kind: 'analytic'; text: string } | { kind: 'card'; cardId: string })[];
  usd: number;
}

export async function aiDraftBlock(input: {
  topic: Topic | undefined;
  side: 'aff' | 'neg';
  speech: string;
  answersTo: string;
  notes: string;
  /** Cards from the debater's own library the block may point to. */
  library: LibraryRef[];
  signal?: AbortSignal;
}): Promise<BlockDraft> {
  const lib = input.library.length
    ? `\nCARDS IN THE DEBATER'S LIBRARY (you may point to these by id; you may not invent others):\n${input.library.map((c) => `- id ${c.id}: ${c.tag} (${c.cite})`).join('\n')}`
    : '\nThe debater has no cards for this yet, so write analytics only.';
  const res = await askClaude<{ title: string; items: { kind: string; text: string; cardId: string }[] }>({
    task: 'Draft a block',
    tier: 'strong',
    effort: 'medium',
    system: system(input.topic),
    user: `Draft an analytical block for the ${input.side === 'aff' ? 'AFFIRMATIVE' : 'NEGATIVE'}${input.speech && input.speech !== 'any' ? `, to be read in the ${input.speech}` : ''}.

What it answers or extends: ${input.answersTo || '(not stated)'}
${input.notes.trim() ? `What the debater wants in it: ${input.notes.trim()}` : ''}

Write 5 to 9 numbered points a debater can read straight off the page. Cover the standard angles that fit (for answering a disadvantage: non-unique, no link, link turn, no internal link, impact defense, impact turn, case outweighs or turns the disad; for a counterplan: permutations, solvency deficits, offense, theory; for case extensions: extend, explain the warrant, answer their best response, impact). Each point: a short label, then one or two sentences of warrant.

Return each point as an item with kind "analytic" and its text. Where one of the library cards below genuinely supports a point, add an item with kind "card" and that card's id right after the analytic it supports. Use "" for cardId on analytic items and "" for text on card items.${lib}`,
    schema: obj({ title: str, items: list(obj({ kind: { type: 'string', enum: ['analytic', 'card'] }, text: str, cardId: str })) }),
    maxTokens: 6000,
    signal: input.signal,
  });
  const known = new Set(input.library.map((c) => c.id));
  const items: BlockDraft['items'] = [];
  for (const it of res.data?.items ?? []) {
    if (it.kind === 'card') {
      if (known.has(it.cardId)) items.push({ kind: 'card', cardId: it.cardId }); // unknown ids are dropped
    } else if (typeof it.text === 'string' && it.text.trim()) {
      items.push({ kind: 'analytic', text: it.text.trim().replace(/^\d+[.)]\s*/, '') });
    }
  }
  if (!items.length) throw new AiError('bad-output', 'The AI did not return any points. Try again.');
  return { title: (res.data?.title ?? '').trim(), items, usd: res.usd };
}

/** Suggest words for the [blanks] of one of the debater's own templates. */
export async function aiFillTemplate(input: { topic: Topic | undefined; body: string; blanks: string[]; context: string; signal?: AbortSignal }): Promise<{ fills: Record<string, string>; usd: number }> {
  const res = await askClaude<{ fills: { blank: string; text: string }[] }>({
    task: 'Fill in a template',
    tier: 'fast',
    effort: 'low',
    system: system(input.topic),
    user: `The debater has a fill-in-the-blank block. Suggest short text for each blank, based only on the situation described. If the situation does not give you what a blank needs (for example an author's name), return "" for that blank rather than making something up.

THE TEMPLATE:
${input.body}

THE BLANKS: ${input.blanks.map((b) => `[${b}]`).join(', ')}

THE SITUATION:
${input.context.trim() || '(nothing given)'}`,
    schema: obj({ fills: list(obj({ blank: str, text: str })) }),
    maxTokens: 2000,
    signal: input.signal,
  });
  const fills: Record<string, string> = {};
  for (const f of res.data?.fills ?? []) if (input.blanks.includes(f.blank) && typeof f.text === 'string') fills[f.blank] = f.text.trim();
  return { fills, usd: res.usd };
}

// ---------------------------------------------------------------------------
// 4. Topicality
// ---------------------------------------------------------------------------

export interface TSuggestion {
  role: string;
  title: string;
  text: string;
}

const T_SECTIONS = list(obj({ role: str, title: str, text: str }));

export async function aiTShell(input: { topic: Topic | undefined; term: string; plan: string; definition: string; signal?: AbortSignal }): Promise<{ sections: TSuggestion[]; usd: number }> {
  const res = await askClaude<{ sections: TSuggestion[] }>({
    task: 'Draft a T shell',
    tier: 'strong',
    effort: 'medium',
    system: system(input.topic),
    user: `Draft a negative topicality shell on the term "${input.term}".

${input.plan.trim() ? `THE AFFIRMATIVE PLAN OR CASE IT IS RUN AGAINST:\n${input.plan.trim()}\n` : 'No specific plan was given; write it for the most common way affirmatives stretch this term.\n'}
${input.definition.trim() ? `THE DEBATER'S DEFINITION CARD (the only evidence you may rely on; quote it exactly if you quote it):\n${input.definition.trim()}\n` : 'The debater has not chosen a definition card yet. Write the interpretation as a plain statement of what the term should mean and say clearly that it needs a definition card behind it. Do not invent a source.\n'}
Return sections, each with a role, a short title and the text to read:
- one "interp": the interpretation
- one "violation": why the plan does not meet it
- three or four "standard": e.g. Limits, Ground, Predictability / Precision, Education. Each must explain the specific abuse on THIS topic, not a generic line.
- two "voter": e.g. Fairness, Education or Jurisdiction, each with a one-sentence reason.`,
    schema: obj({ sections: T_SECTIONS }),
    maxTokens: 5000,
    signal: input.signal,
  });
  return { sections: cleanSections(res.data?.sections, ['interp', 'violation', 'standard', 'voter']), usd: res.usd };
}

export async function aiTAnswers(input: { topic: Topic | undefined; term: string; plan: string; theirShell: string; signal?: AbortSignal }): Promise<{ sections: TSuggestion[]; usd: number }> {
  const res = await askClaude<{ sections: TSuggestion[] }>({
    task: 'Draft T answers',
    tier: 'strong',
    effort: 'medium',
    system: system(input.topic),
    user: `Draft the AFFIRMATIVE's 2AC answers to a topicality argument on "${input.term}".

OUR PLAN:
${input.plan.trim() || '(not given)'}

${input.theirShell.trim() ? `THEIR SHELL (as flowed or pasted):\n${input.theirShell.trim()}\n` : 'Their exact shell was not given; answer the most likely version of this argument.\n'}
Return sections, each with a role, a short title and the text to read:
- one "we-meet": why the plan meets their interpretation
- one "counter-interp": a counter-interpretation, stated plainly. If it needs a definition card, say so; do not invent a source.
- one "reasonability": reasonability versus competing interpretations, with a reason
- two to four "offense": reasons their interpretation is worse for debate (it overlimits, removes core affirmative ground, is arbitrary, and so on), specific to this topic.`,
    schema: obj({ sections: T_SECTIONS }),
    maxTokens: 5000,
    signal: input.signal,
  });
  return { sections: cleanSections(res.data?.sections, ['we-meet', 'counter-interp', 'reasonability', 'offense']), usd: res.usd };
}

export async function aiTExtension(input: { topic: Topic | undefined; speech: string; fileText: string; signal?: AbortSignal }): Promise<{ text: string; usd: number }> {
  const res = await askClaude({
    task: `Draft a ${input.speech} T extension`,
    tier: 'strong',
    effort: 'medium',
    system: system(input.topic),
    user: `Write a ${input.speech} extension block for the topicality file below: a short overview, then the extension of each part with an answer to the other side's most likely response, then why it is a voting issue. Numbered, ready to read, under 250 words. Use only the arguments and evidence in the file.

THE FILE:
${input.fileText}`,
    maxTokens: 3000,
    signal: input.signal,
  });
  return { text: res.text.trim(), usd: res.usd };
}

function cleanSections(raw: unknown, allowed: string[]): TSuggestion[] {
  const out: TSuggestion[] = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const sec = s as Partial<TSuggestion>;
    if (typeof sec.role !== 'string' || typeof sec.text !== 'string' || !sec.text.trim()) continue;
    const role = sec.role.trim().toLowerCase();
    if (!allowed.includes(role)) continue;
    out.push({ role, title: typeof sec.title === 'string' ? sec.title.trim() : '', text: sec.text.trim() });
  }
  if (!out.length) throw new AiError('bad-output', 'The AI did not return anything usable. Try again.');
  return out;
}

export interface PlanAnalysis {
  text: string;
  usd: number;
}

export async function aiAnalyzePlan(input: { topic: Topic | undefined; plan: string; definitions: string; signal?: AbortSignal }): Promise<PlanAnalysis> {
  const res = await askClaude({
    task: 'Is this plan topical?',
    tier: 'strong',
    effort: 'high',
    system: system(input.topic),
    user: `Here is an affirmative plan text. Assess its topicality under the resolution above.

PLAN TEXT:
${input.plan.trim()}

${input.definitions.trim() ? `DEFINITIONS IN THE DEBATER'S LIBRARY (the only evidence you may cite; refer to them by author and year):\n${input.definitions.trim()}\n` : ''}
Go through the resolution phrase by phrase. For each phrase where a topicality argument is realistic, give:
- THE NEG'S ARGUMENT: the interpretation they would read, the violation, and their best standard. Rate how threatening it is (strong / moderate / weak) and say why.
- THE AFF'S BEST ANSWERS: we-meet, a counter-interpretation, and the strongest offense.
Skip phrases the plan clearly meets, in one line. Then finish with:
- THE BIGGEST RISK: the one T argument this plan should prepare for most.
- A SAFER WORDING: if a small change to the plan text would avoid the problem, show it.
Where an argument would need a definition card the debater does not have, say "needs a definition card" instead of inventing a source. Plain text, short headings, no tables.`,
    maxTokens: 7000,
    signal: input.signal,
  });
  return { text: res.text.trim(), usd: res.usd };
}

// ---------------------------------------------------------------------------
// 5. Cross-examination prep
// ---------------------------------------------------------------------------

export interface CheckedText {
  text: string;
  /** Quotes in the text that are NOT in the material the AI was given. */
  badQuotes: string[];
  usd: number;
}

export async function aiCxQuestions(input: { topic: Topic | undefined; cards: string; askingSide: 'aff' | 'neg'; signal?: AbortSignal }): Promise<CheckedText> {
  const res = await askClaude({
    task: 'CX questions',
    tier: 'strong',
    effort: 'medium',
    system: system(input.topic),
    user: `Below is evidence an opposing team has disclosed. The debater is on the ${input.askingSide === 'aff' ? 'AFFIRMATIVE' : 'NEGATIVE'} and will cross-examine the team that reads it. Write cross-examination questions to prepare with.

Number the cards as they appear (Card 1, Card 2, ...). For each card that has a real weakness, give two to four questions under these headings where they apply:
- WEAK WARRANT: the card asserts something without a reason or data.
- MISSING LINK: the tag claims more than the text says, or a step between cause and impact is missing.
- QUALIFICATIONS: who the author is, and whether the card says. Ask; do not assert facts about the author from outside knowledge.
- THE CARD CONCEDES: words in the card's own text that help the other side, including un-highlighted text.
Each question must be short, answerable in a sentence, and set up an argument; after it, add "→ sets up:" and the argument in a few words. When you point at wording, quote the card exactly, in quotation marks.
Finish with THREE QUESTIONS TO ASK FIRST.

THEIR EVIDENCE:
${input.cards}`,
    maxTokens: 6000,
    signal: input.signal,
  });
  const text = res.text.trim();
  return { text, badQuotes: unverifiedQuotes(text, [input.cards]), usd: res.usd };
}

// ---------------------------------------------------------------------------
// 6. Practice: drills and rebuttal feedback
// ---------------------------------------------------------------------------

export async function aiDrillFeedback(input: { topic: Topic | undefined; drill: string; prompt: string; speech: string; context: string; signal?: AbortSignal }): Promise<CheckedText> {
  const res = await askClaude({
    task: 'Drill feedback',
    tier: 'strong',
    effort: 'medium',
    system: system(input.topic),
    user: `The debater did a practice drill: ${input.drill}.

THE ASSIGNMENT:
${input.prompt}

${input.context.trim() ? `WHAT THEY WERE WORKING FROM:\n${input.context.trim()}\n` : ''}
THEIR SPEECH, AS TYPED:
${input.speech.trim()}

Give feedback a coach would give after a practice speech:
1. WHAT WORKED: at most three things, each pointing at a specific line (quote it exactly).
2. WHAT TO FIX: the three to five most important problems, most important first. For each: what is wrong, why a judge cares, and how to say it better (a one- or two-line rewrite).
3. For a topicality speech, check specifically: is the interpretation extended with its definition; is the violation explained; are standards impacted and compared (limits versus ground, competing interpretations versus reasonability); is there a clear reason to vote. For a final rebuttal: are there too many arguments, is there impact comparison, does it close doors on the other team's best argument.
4. REDO: one focused instruction for doing the speech again (for example "give it again in half the time, collapsing to limits").
Be direct and specific. Do not rewrite the whole speech.`,
    maxTokens: 5000,
    signal: input.signal,
  });
  const text = res.text.trim();
  return { text, badQuotes: unverifiedQuotes(text, [input.speech, input.context, input.prompt]), usd: res.usd };
}

export async function aiRebuttalStrategy(input: { topic: Topic | undefined; side: 'aff' | 'neg'; flow: string; notes: string; signal?: AbortSignal }): Promise<CheckedText> {
  const speech = input.side === 'aff' ? '2AR' : '2NR';
  const res = await askClaude({
    task: 'Rebuttal strategy from a flow',
    tier: 'strong',
    effort: 'high',
    system: system(input.topic),
    user: `Here is the debater's flow of a finished (or practice) round. They were on the ${input.side === 'aff' ? 'AFFIRMATIVE' : 'NEGATIVE'}. Each line shows the speech in square brackets; indented lines answer the line above them; {DROPPED} marks arguments the debater flagged as dropped.

THE FLOW:
${input.flow}

${input.notes.trim() ? `THE DEBATER'S NOTES ABOUT THE ROUND:\n${input.notes.trim()}\n` : ''}
Work only from what is on the flow. If the flow is thin or unclear somewhere, say so rather than guessing what was said.
1. WHERE THE ROUND STANDS: three or four sentences on who is ahead where, and why.
2. TWO ${speech} STRATEGIES: for each, what to go for, what to kick or concede, the order of the speech, and the impact comparison to end on. Say which you would choose and why.
3. DROPS AND CONCESSIONS: arguments either side left unanswered that should have been used, and how.
4. THREE REDO DRILLS: specific speeches to give again from this flow (for example "redo the 1AR on the disad in 90 seconds").`,
    maxTokens: 7000,
    signal: input.signal,
  });
  const text = res.text.trim();
  return { text, badQuotes: unverifiedQuotes(text, [input.flow, input.notes]), usd: res.usd };
}
