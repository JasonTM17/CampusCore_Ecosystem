import type {
  AssistantCitationEvent,
  AssistantDoneEvent,
  AssistantErrorEvent,
  AssistantMetaEvent,
} from '../api/assistant-stream';
import type { AssistantStreamAction } from '../api/assistant-stream-state';

export interface TurnSnapshot {
  clientRequestId: string | null;
  meta: AssistantMetaEvent | null;
  answer: string;
  citations: AssistantCitationEvent['citation'][];
  done: AssistantDoneEvent | null;
  error: AssistantErrorEvent | null;
  connectionLost: boolean;
}

const empty = (): TurnSnapshot => ({
  clientRequestId: null,
  meta: null,
  answer: '',
  citations: [],
  done: null,
  error: null,
  connectionLost: false,
});

/**
 * Synchronous mirror of the stream actions the orchestrator dispatches. The
 * reducer drives the view; this keeps the committed turn readable inside the
 * `onSettled` callback, where React state has not updated yet.
 */
export function createTurnAccumulator() {
  let state = empty();
  const seenSequences = new Set<number>();

  return {
    apply(action: AssistantStreamAction): void {
      if (action.type === 'send') {
        state = { ...empty(), clientRequestId: action.clientRequestId };
        seenSequences.clear();
        return;
      }
      if (action.type === 'connectionLost') {
        state = { ...state, connectionLost: true };
        return;
      }
      if (action.type !== 'event') return;
      const { event } = action;
      switch (event.type) {
        case 'meta':
          state = { ...state, meta: event };
          break;
        case 'delta':
          if (seenSequences.has(event.sequence)) break;
          seenSequences.add(event.sequence);
          state = { ...state, answer: state.answer + event.text };
          break;
        case 'replace':
          state = { ...state, answer: event.text };
          break;
        case 'citation': {
          const id = event.citation.id;
          if (typeof id === 'string' && state.citations.some((citation) => citation.id === id)) break;
          state = { ...state, citations: [...state.citations, event.citation] };
          break;
        }
        case 'done':
          state = { ...state, done: event, connectionLost: false };
          break;
        case 'error':
          state = { ...state, error: event };
          break;
      }
    },
    snapshot: (): TurnSnapshot => state,
    reset(): void {
      state = empty();
      seenSequences.clear();
    },
  };
}

export type TurnAccumulator = ReturnType<typeof createTurnAccumulator>;
