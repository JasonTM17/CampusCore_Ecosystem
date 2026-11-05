'use client';

import { AdmissionsApplyPage } from '@/components/admissions/AdmissionsApplyPage';
import { PublicMain } from '@/components/content/PublicMain';

/**
 * /apply — applicant admissions surface (contract §7, phase-10): per-cycle
 * draft, checksum-bound attachments, submit/resubmit/withdraw and the
 * SIMULATED-labeled decision view.
 */
export default function ApplyPage() {
  return (
    <PublicMain>
      <AdmissionsApplyPage />
    </PublicMain>
  );
}
