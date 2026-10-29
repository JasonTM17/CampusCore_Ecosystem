'use client';

// Nested boundary: faults in any admin page render inside the root shell
// instead of unmounting it. app/[locale]/admin mirrors this file so localized
// URLs get the same boundary.
export { default } from '@/components/ui/section-error';
