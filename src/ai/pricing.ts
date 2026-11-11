// Models and what they cost.
//
// Prices are per million tokens (a token is roughly three-quarters of a word).
// They were copied from Anthropic's published rates on the date below and are
// only used to show ESTIMATES in the app. Your real bill is on
// console.anthropic.com. If prices change, update this table.

export const PRICES_AS_OF = '3 November 2026';

export interface ModelInfo {
  id: string;
  label: string;
  /** US dollars per million input tokens. */
  inputPerM: number;
  /** US dollars per million output tokens. */
  outputPerM: number;
  blurb: string;
}

export const MODELS: readonly ModelInfo[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', inputPerM: 0.1, outputPerM: 0.5, blurb: 'Cheapest and fastest. Good for formatting jobs: marking up cards, filling templates.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', inputPerM: 2, outputPerM: 10, blurb: 'Middle option: quick, and good at most prep.' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', inputPerM: 4, outputPerM: 20, blurb: 'Strong reasoning. Good for strategy: blocks, topicality, rebuttal feedback.' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', inputPerM: 8, outputPerM: 40, blurb: 'Most capable and most expensive. Slower; for the hardest strategy questions.' },
];

export function modelInfo(id: string): ModelInfo {
  // An id that is not in the table (a newer model typed in by hand) is priced like the strongest one, so estimates err high.
  return MODELS.find((m) => m.id === id) ?? { id, label: id, inputPerM: 8, outputPerM: 40, blurb: 'Not in the built-in price table; estimates assume the highest listed price.' };
}

/** Very rough token count for a piece of text. Good enough for a cost estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.3);
}

export function costUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const m = modelInfo(modelId);
  return (inputTokens * m.inputPerM + outputTokens * m.outputPerM) / 1_000_000;
}

/** "about $0.03", "under 1¢". */
export function formatUsd(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return 'under 1¢';
  if (usd < 1) return `about ${Math.round(usd * 100)}¢`;
  return `about $${usd.toFixed(2)}`;
}
