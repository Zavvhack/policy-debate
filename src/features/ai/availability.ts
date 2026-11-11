// Is AI set up on this computer, and does the user want to see it?
//
// AI is optional. Most people who use this app will never have an API key,
// and for them AI buttons must not look like broken features. Every AI
// control asks aiMode() how to show itself:
//
//   'ready'   a key is saved             -> the normal button
//   'no-key'  no key yet                 -> one quiet line saying it is an
//                                           optional feature and what it needs
//   'hidden'  "Show AI features" is off  -> nothing at all
//
// This file only reports whether a key EXISTS. It never reads the key and
// never contacts the AI service; that is still only src/ai/client.ts.

import { signal } from '@preact/signals';
import { platform } from '../../platform';
import { settings } from '../../data/store';

/** 'unknown' until checked (a moment after the app opens). */
export const aiKey = signal<'unknown' | 'none' | 'ready'>('unknown');

/** Look again whether a key is saved. Call at start-up and after saving or removing a key. */
export async function refreshAiKey(): Promise<void> {
  try {
    aiKey.value = (await platform.hasApiKey()) ? 'ready' : 'none';
  } catch {
    // No keychain service running, storage blocked...: the same as having no key.
    aiKey.value = 'none';
  }
}

export type AiMode = 'ready' | 'no-key' | 'hidden';

/** How AI controls should show themselves right now. Reading it inside a component keeps that component up to date. */
export function aiMode(): AiMode {
  if (!settings.value.ai.show) return 'hidden';
  return aiKey.value === 'ready' ? 'ready' : 'no-key';
}
