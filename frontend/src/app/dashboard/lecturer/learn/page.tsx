'use client';

import { LecturerLearningPage } from '@/components/learning/LearningConsolePage';

/**
 * /dashboard/lecturer/learn — lecturer LMS console scoped to the
 * section's assigned lecturer (contract §6 authority): materials,
 * assignment lifecycle, submission roster, return/review. The official
 * grade authority (Enrollment/StudentGrade) is never written here.
 */
export default function LecturerLearnPage() {
  return <LecturerLearningPage />;
}
