'use client';

import { StudentLearningPage } from '@/components/learning/LearningConsolePage';

/**
 * /dashboard/learn — student LMS surface: enrolled-section roster
 * read-through, materials, assignments, draft/submit/resubmit with
 * immutable revisions and lecturer feedback (contract §6, phase-09).
 */
export default function LearnPage() {
  return <StudentLearningPage />;
}
