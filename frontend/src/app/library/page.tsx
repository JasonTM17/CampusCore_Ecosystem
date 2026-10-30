'use client';

import { LibraryCataloguePage } from '@/components/library/LibraryCataloguePage';

/**
 * /library — patron library surface (contract §8, phase-11): catalogue
 * search with live availability, copy holds and own loan history.
 */
export default function LibraryPage() {
  return <LibraryCataloguePage />;
}
