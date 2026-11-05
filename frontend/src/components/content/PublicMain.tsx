'use client';

import { ReactNode } from 'react';
import { useI18n } from '@/i18n';

/**
 * Skip link plus main landmark for public lanes that render without
 * `PublicChrome` (library, careers, admissions). Keeping the target id stable
 * lets the shared skip-link styles work on every public surface.
 */
export function PublicMain({ children }: { children: ReactNode }) {
  const { messages } = useI18n();
  return (
    <>
      <a href="#main-content" className="portal-skip-link">
        {messages.home.skipToContent}
      </a>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
