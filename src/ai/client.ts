// THE ONLY DOOR TO THE AI SERVICE
// ===============================
// Every AI feature in the app calls askClaude() in this file. Nothing else in
// the codebase imports the Anthropic SDK or names its API (a test enforces that).
//
// The Round Mode lock is checked here FOUR times per request:
//   1. before anything happens,
//   2. inside the network function the SDK is given (so even an SDK retry is checked),
//   3. any request already in flight is cancelled the moment a round starts,
//   4. after the answer arrives - if a round began meanwhile, the answer is thrown away.
// On the desktop app the Rust core checks a fifth time, and holds the API key.

import Anthropic from '@anthropic-ai/sdk';
import { settings } from '../data/store';
import { platform } from '../platform';
import { signal } from '@preact/signals';
import { AiLockedError, assertAiAllowed, isAiLocked, lockState } from './lock';
import { costUsd, estimateTokens, modelInfo } from './pricing';

export type AiTier = 'fast' | 'strong';
export type AiEffort = 'low' | 'medium' | 'high';

export interface AiRequest {
  /** Short name shown in the spending log, e.g. "Cut a card". */
  task: string;
  /** 'fast' = the cheap model for formatting; 'strong' = the best model for strategy. */
  tier: AiTier;
  system: string;
  user: string;
  /** If given, the answer must be JSON matching this schema. */
  schema?: Record<string, unknown>;
  effort?: AiEffort;
  maxTokens?: number;
  /** Lets the caller cancel (e.g. a Cancel button). */
  signal?: AbortSignal;
}

export interface AiResult<T = unknown> {
  text: string;
  /** The parsed JSON when a schema was given. */
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export type AiErrorKind = 'locked' | 'no-key' | 'auth' | 'rate' | 'network' | 'refused' | 'bad-output' | 'cancelled' | 'other';

/** An AI failure with a message written for the user. */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

// --- spending log ----------------------------------------------------------

export interface AiLogEntry {
  at: number;
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/** What AI has cost since the app was opened (estimates). */
export const aiLog = signal<AiLogEntry[]>([]);

// --- plumbing --------------------------------------------------------------

/** Tests swap these out so no real network or key is needed. */
interface Transport {
  fetch: typeof fetch | null;
  apiKey: (() => Promise<string | null>) | null;
}
const transport: Transport = { fetch: null, apiKey: null };
export function setAiTransportForTests(fetchImpl: typeof fetch | null, apiKey: (() => Promise<string | null>) | null = null): void {
  transport.fetch = fetchImpl;
  transport.apiKey = apiKey;
}

/** Requests currently in flight, so they can be cancelled when a round starts. */
const inFlight = new Set<AbortController>();
lockState.subscribe(() => {
  if (!isAiLocked()) return;
  for (const c of inFlight) c.abort();
  inFlight.clear();
});

/** The network function handed to the SDK. It refuses to send anything while the lock is on. */
const guardedFetch: typeof fetch = (input, init) => {
  assertAiAllowed();
  const impl = transport.fetch ?? platform.aiFetch ?? globalThis.fetch.bind(globalThis);
  return impl(input, init);
};

async function resolveKey(): Promise<string> {
  if (transport.apiKey) {
    const k = await transport.apiKey();
    if (!k) throw new AiError('no-key', 'No API key is saved yet. Add one in Settings → AI.');
    return k;
  }
  if (platform.kind === 'desktop') {
    // The key stays in the system keychain; the Rust core adds it to the request.
    if (!(await platform.hasApiKey())) throw new AiError('no-key', 'No API key is saved yet. Add one in Settings → AI.');
    return 'kept-in-the-system-keychain';
  }
  const key = await platform.readApiKey();
  if (!key) throw new AiError('no-key', 'No API key is saved yet. Add one in Settings → AI.');
  return key;
}

export function modelFor(tier: AiTier): string {
  const ai = settings.value.ai;
  return (tier === 'fast' ? ai.fastModel : ai.strongModel).trim() || (tier === 'fast' ? 'claude-haiku-5-5' : 'claude-opus-5-5');
}

/** A rough "this will cost about..." figure to show before the user presses the button. */
export function estimateRequest(tier: AiTier, promptChars: number, expectedOutputTokens: number): { model: string; usd: number } {
  const model = modelFor(tier);
  return { model, usd: costUsd(model, Math.ceil(promptChars / 3.3) + 400, expectedOutputTokens) };
}

function friendly(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof AiLockedError) return new AiError('locked', err.message);
  if (err instanceof Anthropic.APIUserAbortError) return new AiError(isAiLocked() ? 'locked' : 'cancelled', isAiLocked() ? new AiLockedError().message : 'Cancelled.');
  if (err instanceof Anthropic.AuthenticationError) return new AiError('auth', 'Anthropic did not accept the API key. Check it in Settings → AI.');
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError('auth', 'This API key is not allowed to use that model. Pick another model in Settings → AI.');
  if (err instanceof Anthropic.NotFoundError) return new AiError('other', 'That model was not found. Check the model names in Settings → AI.');
  if (err instanceof Anthropic.RateLimitError) return new AiError('rate', 'Too many requests, or your account is out of credit. Wait a minute and try again, or check console.anthropic.com.');
  if (err instanceof Anthropic.BadRequestError) return new AiError('other', `The AI service rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError('network', 'The AI service took too long to answer. Try again.');
  if (err instanceof Anthropic.APIConnectionError) return new AiError('network', 'Could not reach the AI service. AI needs an internet connection; everything else in the app works offline.');
  if (err instanceof Anthropic.APIError) return new AiError('other', `The AI service had a problem (${err.status ?? 'unknown'}). Try again in a moment.`);
  // The lock message can arrive wrapped (for example from the desktop core).
  const message = err instanceof Error ? err.message : String(err);
  if (isAiLocked()) return new AiError('locked', new AiLockedError().message);
  return new AiError('other', message);
}

/**
 * Ask Claude one question and get one answer. This is the single place the
 * app talks to an AI service.
 */
export async function askClaude<T = unknown>(req: AiRequest): Promise<AiResult<T>> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  try {
    // (1) The lock, before anything else: before the key is read, before any request is built.
    assertAiAllowed();
    req.signal?.addEventListener('abort', onOuterAbort);
    inFlight.add(controller);
    const model = modelFor(req.tier);
    const apiKey = await resolveKey();
    assertAiAllowed();
    const client = new Anthropic({
      apiKey,
      // (2) Every network call the SDK makes goes through the lock.
      fetch: guardedFetch,
      // This app has no server: the key is the user's own and stays on their machine.
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: 5 * 60 * 1000,
    });
    const params = {
      model,
      max_tokens: req.maxTokens ?? 8000,
      system: req.system,
      messages: [{ role: 'user' as const, content: req.user }],
      output_config: {
        effort: req.effort ?? 'medium',
        ...(req.schema ? { format: { type: 'json_schema' as const, schema: req.schema } } : {}),
      },
    };
    const options = { signal: controller.signal };

    // The stronger models can decline a request outright. Asking the service to
    // fall back to another model when that happens avoids a dead end. (The
    // smallest model has no server-side fallback.)
    let message: Anthropic.Message | Anthropic.Beta.BetaMessage;
    if (/haiku/i.test(model)) {
      message = await client.messages.create(params, options);
    } else {
      try {
        message = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, options);
      } catch (err) {
        // If the account or model does not accept the fallback option, send the plain request once.
        if (!(err instanceof Anthropic.BadRequestError)) throw err;
        assertAiAllowed();
        message = await client.messages.create(params, options);
      }
    }

    // (4) If a round started while we were waiting, the answer is discarded unread.
    assertAiAllowed();

    const inputTokens = (message.usage.input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
    const outputTokens = message.usage.output_tokens ?? 0;
    const usd = costUsd(modelInfo(message.model).id === message.model ? message.model : model, inputTokens, outputTokens);
    aiLog.value = [...aiLog.value, { at: Date.now(), task: req.task, model: message.model, inputTokens, outputTokens, usd }];

    if (message.stop_reason === 'refusal') {
      throw new AiError('refused', 'Claude declined to answer this request. Try rewording it.');
    }
    let text = '';
    for (const block of message.content) if (block.type === 'text') text += block.text;
    if (message.stop_reason === 'max_tokens') {
      throw new AiError('bad-output', 'The answer was cut off because it was too long. Try with less text.');
    }
    let data: unknown = null;
    if (req.schema) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new AiError('bad-output', 'The answer came back in the wrong form. Try again.');
      }
    }
    return { text, data: data as T, model: message.model, inputTokens, outputTokens, usd };
  } catch (err) {
    throw friendly(err);
  } finally {
    inFlight.delete(controller);
    req.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Check that the saved key works, without spending anything: lists the models the key can use. */
export async function testApiKey(): Promise<string> {
  try {
    assertAiAllowed();
    const client = new Anthropic({ apiKey: await resolveKey(), fetch: guardedFetch, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 30_000 });
    const page = await client.models.list({ limit: 100 });
    const ids = page.data.map((m) => m.id);
    const wanted = [modelFor('fast'), modelFor('strong')];
    const missing = wanted.filter((m) => !ids.includes(m));
    return missing.length ? `The key works, but it cannot see: ${[...new Set(missing)].join(', ')}. Pick different models below.` : 'The key works and both chosen models are available.';
  } catch (err) {
    throw friendly(err);
  }
}

export { estimateTokens };
