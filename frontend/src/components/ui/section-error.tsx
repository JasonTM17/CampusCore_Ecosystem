'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/state-block';
import { useI18n } from '@/i18n';

/**
 * Shared Next.js segment error boundary (dashboard, admin).
 *
 * Mounted as `<segment>/error.tsx`, it renders inside that segment's layout:
 * the shell — sidebar, header, notification bell — stays mounted while only
 * the faulting section is replaced. The i18n provider sits in the root layout
 * above the fault scope, so `useI18n` is still safe here; `reset()` re-renders
 * the segment and is the localized retry.
 */
export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { messages } = useI18n();

  useEffect(() => {
    console.error('CampusUTE section error:', error);
  }, [error]);

  return (
    <ErrorState
      title={messages.common.states.sectionErrorTitle}
      description={messages.common.states.sectionErrorDescription}
      onRetry={reset}
    />
  );
}
