// Shared pieces for every screen that offers AI help.
//
// These only ever appear in Prep. While a round is on, Prep is not rendered at
// all, and askClaude() refuses anyway.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AiError, estimateRequest, type AiTier } from '../../ai/client';
import { formatUsd, modelInfo } from '../../ai/pricing';
import { updateSettings } from '../../data/store';
import { aiMode } from './availability';

export interface AiRunner {
  busy: boolean;
  error: AiError | null;
  /** Run an AI job. Returns undefined if it failed or was cancelled (the error is shown by <AiStatus>). */
  run: <T>(job: (signal: AbortSignal) => Promise<T>) => Promise<T | undefined>;
  cancel: () => void;
  clearError: () => void;
}

/** Tracks one AI job at a time: busy state, the error to show, and cancelling. */
export function useAi(): AiRunner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Leaving the screen cancels whatever was running.
  useEffect(() => () => controller.current?.abort(), []);
  return {
    busy,
    error,
    clearError: () => setError(null),
    cancel: () => controller.current?.abort(),
    run: async (job) => {
      if (controller.current) return undefined;
      const c = new AbortController();
      controller.current = c;
      setBusy(true);
      setError(null);
      try {
        return await job(c.signal);
      } catch (err) {
        const e = err instanceof AiError ? err : new AiError('other', err instanceof Error ? err.message : String(err));
        if (e.kind !== 'cancelled') setError(e);
        return undefined;
      } finally {
        controller.current = null;
        setBusy(false);
      }
    },
  };
}

/** Switch every AI control off (Settings → AI switches them back on). */
export function hideAiFeatures(): void {
  updateSettings((s) => ({ ...s, ai: { ...s.ai, show: false } }));
}

/**
 * Shown in place of an AI control when no API key is saved: one quiet line
 * that says what this is and what it needs. Not an error, and nothing to fill in.
 */
export function AiNeedsKey({ what }: { what: ComponentChildren }) {
  return (
    <p class="ai-optional">
      <span class="ai-optional-tag">
        <span aria-hidden="true">✦</span> Optional AI feature
      </span>{' '}
      <strong>{what}</strong> needs your own Claude API key.{' '}
      <a class="link" href="#/settings/ai">
        Set up AI
      </a>{' '}
      or{' '}
      <button class="link" onClick={hideAiFeatures}>
        hide AI features
      </button>
      . Everything else works without it.
    </p>
  );
}

/**
 * Wraps a whole AI panel (its heading, its inputs and its button).
 * With no key the panel shrinks to one line; with AI hidden it disappears.
 */
export function AiSection({ title, children }: { title: string; children: ComponentChildren }) {
  const mode = aiMode();
  if (mode === 'hidden') return null;
  if (mode === 'no-key') return <AiNeedsKey what={title} />;
  return <>{children}</>;
}

/** A button that runs an AI job, with a rough cost shown next to it. */
export function AiButton(props: {
  ai: AiRunner;
  onRun: () => void;
  children: ComponentChildren;
  tier: AiTier;
  /** Roughly how many characters of text will be sent. */
  promptChars: number;
  /** Roughly how long the answer will be, in tokens. */
  outputTokens: number;
  disabled?: boolean;
  primary?: boolean;
}) {
  const mode = aiMode();
  if (mode === 'hidden') return null;
  if (mode === 'no-key') return <AiNeedsKey what={props.children} />;
  const est = estimateRequest(props.tier, props.promptChars, props.outputTokens);
  return (
    <span class="ai-button">
      {props.ai.busy ? (
        <button class="btn" onClick={props.ai.cancel}>
          Cancel
        </button>
      ) : (
        <button class={`btn ${props.primary ? 'btn-primary' : ''} btn-ai`} onClick={props.onRun} disabled={props.disabled}>
          <span aria-hidden="true">✦</span> {props.children}
        </button>
      )}
      <span class="field-hint ai-cost" title={`Estimate for ${modelInfo(est.model).label}. Your real cost is shown on console.anthropic.com.`}>
        {props.ai.busy ? 'Working… this can take up to a minute.' : `${formatUsd(est.usd)} · ${modelInfo(est.model).label}`}
      </span>
    </span>
  );
}

/** Shows the last AI error, with a way forward. */
export function AiStatus({ ai }: { ai: AiRunner }) {
  if (!ai.error) return null;
  return (
    <div class="notice notice-danger" role="alert">
      {ai.error.message}{' '}
      {(ai.error.kind === 'no-key' || ai.error.kind === 'auth') && (
        <a class="link" href="#/settings/ai">
          Open AI settings
        </a>
      )}
      <button class="link dismiss" onClick={ai.clearError}>
        Dismiss
      </button>
    </div>
  );
}

/** The label that goes on everything AI wrote. */
export function AiDraftNote({ children }: { children?: ComponentChildren }) {
  return (
    <p class="ai-draft-note">
      <span class="draft-chip">AI draft</span> {children ?? 'Written by AI as a starting point. Check it, rewrite it in your own words, and never read it as evidence.'}
    </p>
  );
}

/** AI feedback text, with any quotes that could not be found in the material flagged. */
export function AiText({ text, badQuotes }: { text: string; badQuotes: string[] }) {
  return (
    <div class="ai-text">
      <AiDraftNote />
      {badQuotes.length > 0 && (
        <div class="notice notice-danger" role="alert">
          <strong>
            {badQuotes.length} quote{badQuotes.length === 1 ? '' : 's'} below could not be found in the text the AI was given.
          </strong>{' '}
          Treat {badQuotes.length === 1 ? 'it' : 'them'} as made up, and do not repeat {badQuotes.length === 1 ? 'it' : 'them'}:
          <ul>
            {badQuotes.map((q) => (
              <li key={q}>“{q}”</li>
            ))}
          </ul>
        </div>
      )}
      <div class="ai-output">{text}</div>
    </div>
  );
}
