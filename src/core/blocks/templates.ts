// Fill-in-the-blank blocks.
//
// A template is ordinary text you own, with blanks written in [square
// brackets]. The presets below are starting points: edit them, delete them, or
// add your own on the Blocks page. In a round you fill the blanks in by hand.
//
// ([[Double brackets]] are different: in a card's tag they mean "underline
// this". They are never treated as blanks.)

import type { ArgCategory, BlockTemplate } from '../../data/schema';
import type { Side } from '../debate/formats';

/** The names of the blanks in a piece of text, in order, without repeats. */
export function blanksOf(text: string): string[] {
  const seen = new Set<string>();
  for (const part of splitBlanks(text)) if ('blank' in part) seen.add(part.blank);
  return [...seen];
}

export type TextPart = { text: string } | { blank: string };

/** Split text into plain pieces and blanks, for drawing each blank as an input box. */
export function splitBlanks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  // A blank is [words] that is not part of [[...]] and is short enough to be a label, not a quote.
  const re = /(?<!\[)\[([^\[\]\n]{1,60})\](?!\])/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ blank: m[1].trim() });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Put values into the blanks. A blank with no value is left as [blank] so it is obvious it still needs filling. */
export function fillBlanks(text: string, fills: Record<string, string> | undefined): string {
  return splitBlanks(text)
    .map((p) => ('text' in p ? p.text : fills?.[p.blank]?.trim() || `[${p.blank}]`))
    .join('');
}

/** How many blanks still have no value. */
export function unfilledCount(text: string, fills: Record<string, string> | undefined): number {
  return blanksOf(text).filter((b) => !fills?.[b]?.trim()).length;
}

interface Preset {
  key: string;
  title: string;
  description: string;
  side: Side | 'both';
  category: ArgCategory;
  body: string;
}

/** The presets that come with the app. They are copied into your data on first run, where you can change them. */
export const PRESET_TEMPLATES: readonly Preset[] = [
  {
    key: 'dropped',
    title: 'Dropped argument',
    description: 'When the other team did not answer something.',
    side: 'both',
    category: 'other',
    body: `They dropped [argument] in the [speech].
Extend [tag / author].
Dropped arguments are treated as true, and that means [impact].
It is too late for new answers: any answer in their next speech is new and should be ignored.`,
  },
  {
    key: 'no-evidence',
    title: 'No evidence',
    description: 'When their argument has no card behind it.',
    side: 'both',
    category: 'other',
    body: `[Argument] is an analytical claim with no card behind it.
Prefer our evidence from [author / qualifications], because [reason].
An assertion is not a reason: they have to prove it, and they have not.`,
  },
  {
    key: 'evidence-comparison',
    title: 'Evidence comparison',
    description: 'Why the judge should prefer your card to theirs.',
    side: 'both',
    category: 'other',
    body: `Prefer our [author] evidence over their [author] evidence:
1. Recency: ours is from [our date], theirs is from [their date], and [what changed in between].
2. Qualifications: our author is [our qualifications]; theirs is [their qualifications].
3. Warrants: our card gives a reason, [our warrant]. Theirs only asserts [their claim].
4. Data: our card cites [numbers / study]. Theirs cites nothing you can check.`,
  },
  {
    key: 'extension',
    title: 'Extension structure',
    description: 'Claim, warrant, impact, and why it outweighs.',
    side: 'both',
    category: 'other',
    body: `Extend [tag / author] from the [speech].
Claim: [claim].
Warrant: [the reason the card gives].
Their answer was [their answer]. It fails because [reason].
Impact: [impact].
That outweighs [their impact] because [magnitude / probability / timeframe].`,
  },
  {
    key: 'impact-calc',
    title: 'Impact calculus',
    description: 'Magnitude, probability, timeframe, and turns-case.',
    side: 'both',
    category: 'impact',
    body: `Our [our impact] outweighs their [their impact]:
1. Magnitude: [how many people / how severe, and why ours is bigger].
2. Probability: [why ours is more likely; why their chain of links is weak].
3. Timeframe: [ours happens first, and why that matters].
4. Turns the case: [our impact] makes [their impact] worse, because [reason]. So even if they win their impact, we control it.`,
  },
  {
    key: 'perm',
    title: 'Permutation',
    description: 'Aff answers to a counterplan or kritik.',
    side: 'aff',
    category: 'cp',
    body: `Permutation: do both. Do the plan and [the counterplan / the alternative].
It solves the net benefit, because [reason the two can work together].
The counterplan is not competitive: [why doing both is possible and better].
Permutations are a test of competition, not a new advocacy.
Second permutation: do the counterplan. [Why the counterplan is not different enough from the plan to compete.]`,
  },
  {
    key: 'condo',
    title: 'CP theory: conditionality bad',
    description: 'When the neg can kick a counterplan at any time.',
    side: 'aff',
    category: 'theory',
    body: `Conditionality is a voting issue.
Interpretation: the negative gets [one conditional advocacy / dispositional advocacies / no conditional advocacies].
Violation: they read [number] conditional advocacies: [which ones].
1. Strategy skew: we cannot make our best answers, because [example of answers that contradict each other].
2. Time skew: they kick whatever we answer well, so our [speech] time is wasted.
3. Depth over breadth: [why fewer, deeper positions make better debates].
Reject the team, not the argument: [reason the harm already happened].`,
  },
  {
    key: 'pics',
    title: 'CP theory: PICs / plan-inclusive counterplans bad',
    description: 'When the counterplan does most of the plan.',
    side: 'aff',
    category: 'theory',
    body: `Plan-inclusive counterplans are illegitimate.
Their counterplan does all of the plan except [the part they exclude].
1. Steals the aff: they use our own case against us, so [number] minutes of the 1AC are wasted.
2. Infinite regress: there are endless tiny things to exclude, so we can never prepare.
3. Topic education: the debate becomes about [the trivial exclusion], not [the topic].
Reject the counterplan. At minimum, we get the permutation: [perm].`,
  },
  {
    key: 'new-args',
    title: 'New-in-the-2 / new arguments in rebuttals',
    description: 'When they make a new argument too late.',
    side: 'both',
    category: 'theory',
    body: `[Argument] is new in the [speech]. It was not in their [earlier speech].
New arguments in [the 2NC / the rebuttals] are illegitimate:
1. We have no fair chance to answer: [which of our speeches is too short or already over].
2. It rewards hiding arguments until it is too late.
Disregard it. If you do evaluate it: [short answer].`,
  },
  {
    key: 't-extension',
    title: 'T: 2NR overview',
    description: 'Collapsing to topicality in the last negative speech.',
    side: 'neg',
    category: 't',
    body: `Topicality is the whole 2NR. Three reasons we win it.
Interpretation: [term] means [definition], from [author].
Violation: the plan [what the plan does], which is not [the term].
Their we-meet fails because [reason].
Our interpretation is better for debate:
1. Limits: under their interpretation, [list of cases that become topical]. That is [number] more affs to prepare for.
2. Ground: we lose [core negative arguments].
Their counter-interpretation [their counter-interp] is worse because [reason].
Competing interpretations, not reasonability: [reason].
Topicality is a voting issue for [fairness / education / jurisdiction].`,
  },
  {
    key: 't-2ar',
    title: 'T: 2AR answer',
    description: 'Closing out topicality in the last affirmative speech.',
    side: 'aff',
    category: 't',
    body: `We are topical. Four reasons.
1. We meet: the plan [what the plan does], which is [the term] under their own interpretation, because [reason].
2. Counter-interpretation: [term] means [our definition], from [author]. We meet it.
3. Our interpretation is better: theirs overlimits. It excludes [core affirmatives], including [example from the novice case list or the topic literature].
4. Reasonability: we are reasonably topical. [Why a small difference in limits is not a reason to vote down a core-of-the-topic aff.]
They have not shown any abuse in this round: they read [the arguments they got to read].`,
  },
];

/** Turn the presets into saved templates (used the first time the app runs). */
export function presetTemplates(now: number): BlockTemplate[] {
  return PRESET_TEMPLATES.map((p, i) => ({
    id: `preset-${p.key}`,
    createdAt: now + i,
    updatedAt: now + i,
    title: p.title,
    description: p.description,
    side: p.side,
    category: p.category,
    body: p.body,
    builtIn: true,
  }));
}
