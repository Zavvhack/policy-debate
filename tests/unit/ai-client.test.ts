// The AI client and the Round Mode lock, tested together with a fake network.
// No real requests are made and no API key is needed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, aiLog, askClaude, estimateRequest, setAiTransportForTests, testApiKey } from '../../src/ai/client';
import { engageLock, initLock, releaseLock, resetLockForTests } from '../../src/ai/lock';
import { costUsd, estimateTokens, formatUsd, MODELS, modelInfo } from '../../src/ai/pricing';
import { openBackend } from '../../src/data/db';
import { closeStoreForTests, initStore, updateSettings } from '../../src/data/store';
import { endRound, startRound } from '../../src/features/round/roundService';

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A stand-in for the Anthropic API. Records what it was sent and answers with `reply`. */
function fakeApi(reply: (seen: Seen) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>) {
  const calls: Seen[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const seen: Seen = { url: String(input), headers, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(seen);
    const r = await reply(seen);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch, spy: fetchImpl };
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  json: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
    ...extra,
  },
});

const REQ = { task: 'Test', tier: 'fast' as const, system: 'sys', user: 'hello' };
const meta = { tournament: '', roundNumber: '', side: 'aff' as const, opponent: '', judge: '', room: '' };

beforeEach(async () => {
  closeStoreForTests();
  resetLockForTests();
  aiLog.value = [];
  await initStore(await openBackend(`ai-${Math.random().toString(36).slice(2)}`));
});

describe('normal use (no round in progress)', () => {
  it('sends one request to the Anthropic API with the key, and returns the answer and its cost', async () => {
    const api = fakeApi(() => message('hi there'));
    setAiTransportForTests(api.fetchImpl, async () => 'sk-test-key');
    const result = await askClaude(REQ);
    expect(result.text).toBe('hi there');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(api.calls[0].headers.authorization).toBe('Bearer sk-test-key'); // the key goes only in the auth header
    expect(api.calls[0].body).toMatchObject({ model: 'claude-haiku-5-5', system: 'sys', messages: [{ role: 'user', content: 'hello' }], output_config: { effort: 'medium' } });
    // 1000 input + 200 output tokens of Haiku 5.5: $0.0001 + $0.0001.
    expect(result.usd).toBeCloseTo(0.0002, 6);
    expect(aiLog.value).toHaveLength(1);
    expect(aiLog.value[0]).toMatchObject({ task: 'Test', inputTokens: 1000, outputTokens: 200 });
  });

  it('uses the model chosen in Settings for each tier, and asks for a fallback on the stronger models', async () => {
    const api = fakeApi(() => message('ok', { model: 'claude-opus-5-5' }));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    await askClaude({ ...REQ, tier: 'strong', effort: 'high' });
    expect(api.calls[0].body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'high' } });
    expect(api.calls[0].headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    updateSettings((s) => ({ ...s, ai: { ...s.ai, strongModel: 'claude-sonnet-5-5', fastModel: 'claude-sonnet-5-5' } }));
    await askClaude({ ...REQ, tier: 'fast' });
    expect(api.calls[1].body.model).toBe('claude-sonnet-5-5');
  });

  it('if the fallback option is rejected, sends the plain request once instead', async () => {
    const api = fakeApi((seen) => (seen.body.fallbacks ? { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'unknown beta' } } } : message('plain ok', { model: 'claude-opus-5-5' })));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const result = await askClaude({ ...REQ, tier: 'strong' });
    expect(result.text).toBe('plain ok');
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].body.fallbacks).toBeUndefined();
  });

  it('parses JSON answers and rejects malformed ones', async () => {
    const schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false };
    let body = '{"n": 7}';
    const api = fakeApi(() => message(body));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    expect((await askClaude<{ n: number }>({ ...REQ, schema })).data).toEqual({ n: 7 });
    expect(api.calls[0].body.output_config).toMatchObject({ format: { type: 'json_schema', schema } });
    body = 'Sure! Here you go: {n: 7}';
    await expect(askClaude({ ...REQ, schema })).rejects.toMatchObject({ kind: 'bad-output' });
  });

  it('explains common failures in plain words', async () => {
    const cases: [number, string, string][] = [
      [401, 'authentication_error', 'auth'],
      [403, 'permission_error', 'auth'],
      [429, 'rate_limit_error', 'rate'],
      [404, 'not_found_error', 'other'],
    ];
    for (const [status, type, kind] of cases) {
      const api = fakeApi(() => ({ status, json: { type: 'error', error: { type, message: 'x' } } }));
      setAiTransportForTests(api.fetchImpl, async () => 'k');
      const err = await askClaude(REQ).catch((e) => e);
      expect(err).toBeInstanceOf(AiError);
      expect(err.kind, String(status)).toBe(kind);
      expect(err.message).not.toMatch(/undefined|\[object/);
    }
    setAiTransportForTests((() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch, async () => 'k');
    await expect(askClaude(REQ)).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports a refusal and a cut-off answer instead of returning half an answer', async () => {
    let extra: Record<string, unknown> = { stop_reason: 'refusal', content: [] };
    const api = fakeApi(() => message('', extra));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    await expect(askClaude(REQ)).rejects.toMatchObject({ kind: 'refused' });
    extra = { stop_reason: 'max_tokens' };
    await expect(askClaude(REQ)).rejects.toMatchObject({ kind: 'bad-output' });
  });

  it('says so when no key has been saved, without touching the network', async () => {
    const api = fakeApi(() => message('x'));
    setAiTransportForTests(api.fetchImpl, async () => null);
    await expect(askClaude(REQ)).rejects.toMatchObject({ kind: 'no-key' });
    expect(api.spy).not.toHaveBeenCalled();
  });

  it('can be cancelled', async () => {
    const api = fakeApi(() => new Promise(() => {}));
    setAiTransportForTests(((input: RequestInfo | URL, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))as unknown as typeof fetch, async () => 'k');
    void api;
    const c = new AbortController();
    const p = askClaude({ ...REQ, signal: c.signal });
    setTimeout(() => c.abort(), 10);
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('ROUND MODE: no AI, ever', () => {
  it('refuses before the lock has even loaded, with no network call', async () => {
    resetLockForTests(); // "not loaded yet"
    const api = fakeApi(() => message('x'));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    await expect(askClaude(REQ)).rejects.toMatchObject({ kind: 'locked' });
    await expect(testApiKey()).rejects.toThrow(/Round Mode is on/);
    expect(api.spy).not.toHaveBeenCalled();
  });

  it('refuses every request during a round, with no network call and no key read', async () => {
    const api = fakeApi(() => message('x'));
    const keyReader = vi.fn(async () => 'k');
    setAiTransportForTests(api.fetchImpl, keyReader);
    await startRound({ name: '', meta, practice: false, formatId: 'nsda-hs', mergeBlock: false });
    for (const tier of ['fast', 'strong'] as const) {
      const err = await askClaude({ ...REQ, tier }).catch((e) => e);
      expect(err).toBeInstanceOf(AiError);
      expect(err.kind).toBe('locked');
      expect(err.message).toMatch(/Round Mode is on/);
    }
    expect(api.spy).not.toHaveBeenCalled();
    expect(keyReader).not.toHaveBeenCalled();
    expect(aiLog.value).toEqual([]);
  });

  it('works again only after the round is ended', async () => {
    const api = fakeApi(() => message('back'));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    await startRound({ name: '', meta, practice: true, formatId: 'nsda-hs', mergeBlock: false });
    await expect(askClaude(REQ)).rejects.toMatchObject({ kind: 'locked' });
    await endRound();
    expect((await askClaude(REQ)).text).toBe('back');
    expect(api.spy).toHaveBeenCalledTimes(1);
  });

  it('a request already in flight is cancelled when a round starts, and its answer is never delivered', async () => {
    let release: (v: { json: unknown }) => void = () => {};
    let aborted = false;
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
        release = (r) => resolve(new Response(JSON.stringify(r.json), { status: 200, headers: { 'content-type': 'application/json' } }));
      })) as unknown as typeof fetch;
    setAiTransportForTests(fetchImpl, async () => 'k');
    const pending = askClaude(REQ).then(
      (r) => ({ ok: true as const, r }),
      (e) => ({ ok: false as const, e }),
    );
    await new Promise((r) => setTimeout(r, 20));
    await engageLock('round-x', Date.now());
    release(message('too late')); // even if the network still answers...
    const outcome = await pending;
    expect(aborted).toBe(true);
    expect(outcome.ok).toBe(false); // ...nothing is returned
    if (!outcome.ok) expect(outcome.e.kind).toBe('locked');
    expect(aiLog.value).toEqual([]);
    await releaseLock();
  });

  it('an answer that arrives after a round started is discarded even if cancelling failed', async () => {
    // A network layer that ignores cancellation and answers anyway.
    let release: () => void = () => {};
    const fetchImpl = (() => new Promise<Response>((resolve) => (release = () => resolve(new Response(JSON.stringify(message('leaked?').json), { status: 200, headers: { 'content-type': 'application/json' } }))))) as unknown as typeof fetch;
    setAiTransportForTests(fetchImpl, async () => 'k');
    const pending = askClaude(REQ).catch((e) => e);
    await new Promise((r) => setTimeout(r, 20));
    await engageLock('round-y', Date.now());
    release();
    const err = await pending;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('locked');
    await releaseLock();
  });

  it('the SDK cannot retry its way past the lock', async () => {
    // First attempt fails with a retryable error; a round starts before the retry.
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) {
        initLock({ active: true, roundId: 'r', since: 1 }, async () => {});
        return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }), { status: 529, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(message('retry got through').json), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    setAiTransportForTests(fetchImpl, async () => 'k');
    const err = await askClaude(REQ).catch((e) => e);
    expect(err.kind).toBe('locked');
    expect(n).toBe(1);
  });
});

describe('cost estimates', () => {
  it('uses the published prices', () => {
    expect(MODELS.map((m) => [m.id, m.inputPerM, m.outputPerM])).toEqual([
      ['claude-haiku-5-5', 0.1, 0.5],
      ['claude-sonnet-5-5', 2, 10],
      ['claude-opus-5-5', 4, 20],
      ['claude-fable-5-2', 8, 40],
    ]);
    expect(costUsd('claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24);
    expect(modelInfo('some-future-model').inputPerM).toBe(8); // unknown models are estimated high, never low
  });
  it('formats small amounts sensibly', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.004)).toBe('under 1¢');
    expect(formatUsd(0.034)).toBe('about 3¢');
    expect(formatUsd(1.5)).toBe('about $1.50');
    expect(estimateTokens('x'.repeat(3300))).toBe(1000);
    const e = estimateRequest('strong', 33_000, 2000);
    expect(e.model).toBe('claude-opus-5-5');
    expect(e.usd).toBeCloseTo((10_400 * 4 + 2000 * 20) / 1e6, 5);
  });
});

// ---------------------------------------------------------------------------
// AI tasks: the answer is checked before anything is used
// ---------------------------------------------------------------------------
import { aiCutCard, aiCxQuestions, aiDraftBlock, aiFillTemplate, aiTShell, cutPrompt, topicBrief } from '../../src/ai/tasks';
import { numberWords } from '../../src/core/cards/cutter';
import { findQuotes, unverifiedQuotes } from '../../src/core/ai/quotes';
import { defaultTopic } from '../../src/core/debate/topics';

const ARTICLE2 = `Why coverage gaps persist
By Dr. Maria Okafor, professor of health policy at Example University
January 28, 2026 — The Example Review

Roughly 26 million Americans remain uninsured. That number is not falling. Subsidies that expired in 2025 pushed premiums up in most states, and enrollment dropped.

A single-payer system would not eliminate every cost. It would, however, cut administrative spending by an estimated $500 billion a year.`;

describe('AI card cutting', () => {
  const words = numberWords(ARTICLE2);
  const idx = (w: string) => words.findIndex((x) => ARTICLE2.slice(x.s, x.e) === w);
  const topic = defaultTopic(0);
  const input = { source: ARTICLE2, meta: '', side: 'neg' as const, claim: 'coverage gaps', tag: '', density: 'medium' as const, topic };
  const plan = (extra: Record<string, unknown> = {}) => ({
    start: idx('Roughly'),
    end: idx('dropped.'),
    spans: [{ from: idx('Roughly'), to: idx('uninsured.'), level: 'h' }],
    tag: 'Coverage gaps are [[not closing]]',
    cite: { first: 'Maria', last: 'Okafor', year: '2026', date: '1/28', quals: 'professor of health policy at Example University', title: 'Why coverage gaps persist', publication: 'The Example Review' },
    ...extra,
  });

  it('builds the card from the article, never from the model’s words', async () => {
    // The model also sends a "text" field full of altered wording. It must be ignored.
    const api = fakeApi(() => message(JSON.stringify(plan({ text: 'Roughly 96 million Americans are uninsured!!' }))));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const out = await aiCutCard(input);
    expect(out.cut.text).toBe(ARTICLE2.slice(words[idx('Roughly')].s, words[idx('dropped.')].e));
    expect(ARTICLE2.includes(out.cut.text)).toBe(true);
    expect(JSON.stringify(out)).not.toContain('96 million');
    expect(out.tagDraft).toBe(true);
    expect(out.cite).toMatchObject({ first: 'Maria', last: 'Okafor', year: '2026', quals: 'professor of health policy at Example University' });
    expect(out.citeDropped).toEqual([]);
    // The prompt shows numbered words and the exact resolution, and asks for numbers only.
    const sent = api.calls[0].body as { messages: { content: string }[]; system: string };
    expect(sent.messages[0].content).toContain('Roughly‹');
    expect(sent.messages[0].content).toContain('BY NUMBER ONLY');
    expect(sent.system).toContain(topic.resolution);
  });

  it('throws away cite details that are not in the article', async () => {
    const api = fakeApi(() => message(JSON.stringify(plan({ cite: { first: 'Maria', last: 'Okafor', year: '2023', date: '', quals: 'Nobel Prize-winning economist', title: 'Why coverage gaps persist', publication: 'The New York Times' } }))));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const out = await aiCutCard(input);
    expect(out.citeDropped.sort()).toEqual(['publication', 'quals', 'year']);
    expect(out.cite.quals).toBe('');
    expect(out.cite.year).toBe('');
    expect(out.cite.publication).toBe('');
    expect(out.cite.last).toBe('Okafor');
  });

  it('keeps the debater’s own tag and marks nothing as a draft', async () => {
    const api = fakeApi(() => message(JSON.stringify(plan({ tag: 'AI wants this tag' }))));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const out = await aiCutCard({ ...input, tag: 'My own [[tag]]' });
    expect(out.tag).toEqual([{ t: 'My own ' }, { t: 'tag', u: true }]);
    expect(out.tagDraft).toBe(false);
  });

  it('retries once after an unusable answer, then gives up without creating anything', async () => {
    let n = 0;
    const api = fakeApi(() => message(JSON.stringify(n++ === 0 ? plan({ end: 99999 }) : plan())));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const out = await aiCutCard(input);
    expect(api.calls).toHaveLength(2);
    expect((api.calls[1].body as { messages: { content: string }[] }).messages[0].content).toContain('previous answer could not be used');
    expect(out.cut.text.startsWith('Roughly')).toBe(true);

    const bad = fakeApi(() => message(JSON.stringify(plan({ start: 50, end: 10 }))));
    setAiTransportForTests(bad.fetchImpl, async () => 'k');
    await expect(aiCutCard(input)).rejects.toMatchObject({ kind: 'bad-output' });
    expect(bad.calls).toHaveLength(2);
  });

  it('refuses to send a scrap of text, and describes definitions when asked', async () => {
    const api = fakeApi(() => message('{}'));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    await expect(aiCutCard({ ...input, source: 'Too short.' })).rejects.toThrow(/Paste more/);
    expect(api.spy).not.toHaveBeenCalled();
    expect(cutPrompt({ ...input, term: 'establish' }, 'x‹0›', 1)).toContain('DEFINITION of "establish"');
    expect(topicBrief(topic)).toContain('Novice case limits: Medicare for All');
  });
});

describe('other AI drafts are filtered before use', () => {
  const topic = defaultTopic(0);
  it('block drafts may only point at cards that really exist in the library', async () => {
    const api = fakeApi(() =>
      message(JSON.stringify({ title: '2AC Econ DA', items: [{ kind: 'analytic', text: '1. Non-unique: spending is rising now.', cardId: '' }, { kind: 'card', text: '', cardId: 'real-1' }, { kind: 'card', text: '', cardId: 'invented-9' }, { kind: 'analytic', text: '  ', cardId: '' }] }), { model: 'claude-opus-5-5' }),
    );
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const draft = await aiDraftBlock({ topic, side: 'aff', speech: '2AC', answersTo: 'Econ DA', notes: '', library: [{ id: 'real-1', tag: 'Spending high now', cite: 'Lee 25' }] });
    expect(draft.items).toEqual([{ kind: 'analytic', text: 'Non-unique: spending is rising now.' }, { kind: 'card', cardId: 'real-1' }]);
  });

  it('template suggestions are limited to the template’s own blanks', async () => {
    const api = fakeApi(() => message(JSON.stringify({ fills: [{ blank: 'arg', text: 'the link turn' }, { blank: 'not-a-blank', text: 'x' }] })));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const out = await aiFillTemplate({ topic, body: 'They dropped [arg] in the [speech].', blanks: ['arg', 'speech'], context: 'They dropped our link turn.' });
    expect(out.fills).toEqual({ arg: 'the link turn' });
  });

  it('T shell sections with unknown roles are dropped', async () => {
    const api = fakeApi(() => message(JSON.stringify({ sections: [{ role: 'Interp', title: 'Interpretation', text: 'Establish means create.' }, { role: 'evidence', title: 'Fake card', text: 'Smith 2024 says...' }, { role: 'standard', title: 'Limits', text: 'Their interp explodes limits.' }] }), { model: 'claude-opus-5-5' }));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const out = await aiTShell({ topic, term: 'establish', plan: '', definition: '' });
    expect(out.sections.map((s) => s.role)).toEqual(['interp', 'standard']);
  });

  it('quotes in AI feedback that are not in the material are flagged', async () => {
    const cards = 'Card: Costs will rise sharply over the next decade, the report found. Critics disagree with the estimate.';
    const answer = 'Card 1 says "Costs will rise sharply over the next decade" but also claims "taxes will double within five years". Ask about "Critics disagree ... the estimate".';
    const api = fakeApi(() => message(answer, { model: 'claude-opus-5-5' }));
    setAiTransportForTests(api.fetchImpl, async () => 'k');
    const out = await aiCxQuestions({ topic, cards, askingSide: 'neg' });
    expect(out.badQuotes).toEqual(['taxes will double within five years']);
    expect(findQuotes('He said "no" and “this is a longer quoted phrase”.')).toEqual(['this is a longer quoted phrase']);
    expect(unverifiedQuotes('“Costs will rise sharply over the next decade,”', [cards])).toEqual([]);
    expect(unverifiedQuotes('"the estimate ... Costs will rise"', [cards])).toHaveLength(1); // pieces out of order
  });
});
