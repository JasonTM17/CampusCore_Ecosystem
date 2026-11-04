'use client';

import { streamProgressText } from './assistant-messages';

interface AssistantStreamProgressProps {
  active: boolean;
  /** Characters received so far, already bucketed by the caller. */
  characters: number;
  slow?: boolean;
  locale: string;
}

/**
 * Dedicated polite live region for stream progress.
 *
 * The message log keeps `role="log"` and `aria-busy` while a turn streams;
 * this region reports that a reply is arriving without exposing token-level
 * partial content to screen readers.
 */
export function AssistantStreamProgress({
  active,
  characters,
  slow = false,
  locale,
}: AssistantStreamProgressProps) {
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-assistant-stream-progress
    >
      {active ? streamProgressText(locale, { characters, slow }) : ''}
    </div>
  );
}
