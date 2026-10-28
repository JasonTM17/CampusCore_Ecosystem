import type { AssistantScope } from '../api/assistant-api';

/**
 * One-shot hand-off from an entry point (for example thesis detail) to the
 * assistant screen. It holds a corpus scope only: no round, report or personal
 * content travels with it, and the screen clears it on first read.
 */
let pending: AssistantScope | null = null;

export function requestAssistantEntryScope(scope: AssistantScope): void {
  pending = scope;
}

/** Read without clearing, so a render that runs twice sees the same hand-off. */
export function peekAssistantEntryScope(): AssistantScope | null {
  return pending;
}

export function consumeAssistantEntryScope(): AssistantScope | null {
  const scope = pending;
  pending = null;
  return scope;
}
