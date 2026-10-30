'use client';

import { LibraryDeskPage } from '@/components/library/LibraryDeskPage';

/**
 * /library/desk — staff circulation desk (contract §8, phase-11): the
 * STAFF:library grant is enforced server-side; approve/issue/return/cancel
 * with stock restored transactionally.
 */
export default function LibraryDeskRoute() {
  return <LibraryDeskPage />;
}
