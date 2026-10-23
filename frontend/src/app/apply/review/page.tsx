'use client';

import { AdmissionsReviewPage } from '@/components/admissions/AdmissionsReviewPage';

/**
 * /apply/review — staff admissions queue (contract §7, phase-10): the
 * STAFF:admissions grant is enforced server-side; claim/return/decide with
 * checklist history and SIMULATED-labeled decisions.
 */
export default function ApplyReviewPage() {
  return <AdmissionsReviewPage />;
}
