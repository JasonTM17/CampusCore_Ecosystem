'use client';

// Nested boundary: faults in any dashboard page render inside the dashboard
// layout instead of unmounting the shell. app/[locale]/dashboard mirrors this
// file so localized URLs get the same boundary.
export { default } from '@/components/ui/section-error';
