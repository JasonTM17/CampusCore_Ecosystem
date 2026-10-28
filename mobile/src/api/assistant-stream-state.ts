import type {
  AssistantCitationEvent,
  AssistantStreamEvent,
} from './assistant-stream';
import { canResubmitSameRequest } from './assistant-stream';

export type AssistantStreamPhase =
  | 'idle'
  | 'sending'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface AssistantStreamState {
  phase: AssistantStreamPhase;
  clientRequestId: string | null;
  meta: Extract<AssistantStreamEvent, { type: 'meta' }> | null;
  answer: string;
  sourceIds: string[];
  citations: AssistantCitationEvent['citation'][];
  degraded: boolean | null;
  reasonCode: string | null;
  terminalStatus: string | null;
  error: { code: string; retryable: boolean } | null;
  connectionLost: boolean;
  backgrounded: boolean;
  mounted: boolean;
  seenFrames: string[];
  seenDeltaSequences: number[];
}

export type AssistantStreamAction =
  | { type: 'send'; clientRequestId: string }
  | { type: 'event'; event: AssistantStreamEvent }
  | { type: 'cancel' }
  | { type: 'connectionLost'; code?: string }
  | { type: 'background' }
  | { type: 'foreground' }
  | { type: 'unmount' }
  | { type: 'mount' };

export const initialAssistantStreamState: AssistantStreamState = {
  phase: 'idle',
  clientRequestId: null,
  meta: null,
  answer: '',
  sourceIds: [],
  citations: [],
  degraded: null,
  reasonCode: null,
  terminalStatus: null,
  error: null,
  connectionLost: false,
  backgrounded: false,
  mounted: true,
  seenFrames: [],
  seenDeltaSequences: [],
};

function unique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function frameKey(event: AssistantStreamEvent): string {
  if (event.type === 'delta') return `delta:${event.sequence}`;
  if (event.type === 'citation' && typeof event.citation.id === 'string') {
    return `citation:${event.citation.id}`;
  }
  if (event.type === 'meta') return 'meta';
  return `${event.type}:${JSON.stringify(event)}`;
}

function isTerminal(state: AssistantStreamState): boolean {
  return state.phase === 'complete' || state.phase === 'error' || state.phase === 'cancelled';
}

export function assistantStreamReducer(
  state: AssistantStreamState,
  action: AssistantStreamAction,
): AssistantStreamState {
  switch (action.type) {
    case 'send':
      if (state.phase === 'sending' || state.phase === 'streaming') return state;
      return {
        ...initialAssistantStreamState,
        phase: 'sending',
        clientRequestId: action.clientRequestId,
        backgrounded: state.backgrounded,
        mounted: state.mounted,
      };
    case 'event': {
      if (isTerminal(state)) return state;
      const event = action.event;
      const key = frameKey(event);
      if (state.seenFrames.includes(key)) return state;
      const seenFrames = [...state.seenFrames, key];

      switch (event.type) {
        case 'meta':
          return {
            ...state,
            phase: 'streaming',
            clientRequestId: event.clientRequestId,
            meta: event,
            seenFrames,
          };
        case 'delta':
          if (state.seenDeltaSequences.includes(event.sequence)) return state;
          return {
            ...state,
            phase: 'streaming',
            answer: state.answer + event.text,
            sourceIds: event.sourceIds.reduce(unique, state.sourceIds),
            seenFrames,
            seenDeltaSequences: [...state.seenDeltaSequences, event.sequence],
          };
        case 'replace':
          return {
            ...state,
            phase: 'streaming',
            answer: event.text,
            sourceIds: event.sourceIds.reduce(unique, state.sourceIds),
            reasonCode: event.reasonCode ?? state.reasonCode,
            seenFrames,
          };
        case 'citation': {
          const citationId = event.citation.id;
          if (
            typeof citationId === 'string'
            && state.citations.some((citation) => citation.id === citationId)
          ) {
            return state;
          }
          return { ...state, phase: 'streaming', citations: [...state.citations, event.citation], seenFrames };
        }
        case 'done':
          return {
            ...state,
            phase: 'complete',
            degraded: event.degraded,
            reasonCode: event.reasonCode,
            terminalStatus: event.terminalStatus,
            connectionLost: false,
            error: null,
            seenFrames,
          };
        case 'error':
          return {
            ...state,
            phase: event.code === 'TURN_CANCELLED' ? 'cancelled' : 'error',
            error: { code: event.code, retryable: event.retryable },
            terminalStatus: event.code === 'TURN_CANCELLED' ? 'CANCELLED' : null,
            connectionLost: event.code === 'STREAM_CONNECTION_LOST',
            seenFrames,
          };
      }
    }
    case 'cancel':
      if (state.phase !== 'sending' && state.phase !== 'streaming') return state;
      return {
        ...state,
        phase: 'cancelled',
        terminalStatus: 'CANCELLED',
        connectionLost: false,
        error: null,
      };
    case 'connectionLost':
      if (state.phase !== 'sending' && state.phase !== 'streaming') return state;
      return {
        ...state,
        phase: 'error',
        error: { code: action.code ?? 'STREAM_INCOMPLETE', retryable: true },
        terminalStatus: null,
        connectionLost: true,
      };
    case 'background':
      return state.backgrounded ? state : { ...state, backgrounded: true };
    case 'foreground':
      return state.backgrounded ? { ...state, backgrounded: false } : state;
    case 'unmount':
      return state.mounted ? { ...state, mounted: false } : state;
    case 'mount':
      return state.mounted ? state : { ...state, mounted: true };
  }
}

export interface AssistantStreamView {
  phase: AssistantStreamPhase;
  answer: string;
  citations: AssistantCitationEvent['citation'][];
  degraded: boolean | null;
  reasonCode: string | null;
  error: AssistantStreamState['error'];
  canResubmitSameRequest: boolean;
}

export function selectAssistantStreamView(state: AssistantStreamState): AssistantStreamView {
  return {
    phase: state.phase,
    answer: state.answer,
    citations: state.citations,
    degraded: state.degraded,
    reasonCode: state.reasonCode,
    error: state.error,
    canResubmitSameRequest: canResubmitSameRequest(state),
  };
}
