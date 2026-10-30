'use client';

// Mirror of app/dashboard/error.tsx — the [locale] tree is the routed one for
// /vi|en/dashboard URLs, so the boundary must exist here to keep the shared
// dashboard shell mounted. Same shared component, single hop.
export { default } from '@/components/ui/section-error';
