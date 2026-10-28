// The round a student is currently looking at, shared by the thesis screens.
// It holds only a round id (never account data); an id that is no longer
// listed falls back to the default round in `pickDefaultRound`.

import { useSyncExternalStore } from 'react';

let selectedRoundId: string | null = null;
const listeners = new Set<() => void>();

export function getSelectedThesisRoundId(): string | null {
  return selectedRoundId;
}

export function selectThesisRound(roundId: string | null): void {
  if (roundId === selectedRoundId) return;
  selectedRoundId = roundId;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSelectedThesisRoundId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedThesisRoundId, getSelectedThesisRoundId);
}
