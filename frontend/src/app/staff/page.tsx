'use client';

import { StaffDesksPage } from '@/components/staff/StaffDesksPage';

/**
 * /staff — staff desk start page: each linked desk re-checks its scoped
 * STAFF:<domain> grant server-side; the page only surfaces which desks the
 * session's grant probes answered, never applicant/borrower/candidate data.
 */
export default function StaffPage() {
  return <StaffDesksPage />;
}
