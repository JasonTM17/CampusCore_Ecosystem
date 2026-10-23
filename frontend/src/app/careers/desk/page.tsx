'use client';

import { CareersDeskPage } from '@/components/careers/CareersDeskPage';

/**
 * /careers/desk — org-recruiter + platform-reviewer surface (contract §9,
 * phase-12): grant scope is enforced server-side; the desk only renders
 * what the scoped APIs return.
 */
export default function CareersDeskRoute() {
  return <CareersDeskPage />;
}
