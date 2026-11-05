'use client';

import { LibraryCataloguePage } from '@/components/library/LibraryCataloguePage';
import { PublicMain } from '@/components/content/PublicMain';

/**
 * /library — patron library surface (contract §8, phase-11): catalogue
 * search with live availability, copy holds and own loan history.
 */
export default function LibraryPage() {
  return (
    <PublicMain>
      <LibraryCataloguePage />
    </PublicMain>
  );
}
