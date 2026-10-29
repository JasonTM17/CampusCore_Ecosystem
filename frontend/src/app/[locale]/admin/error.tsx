'use client';

// Mirror of app/admin/error.tsx — the [locale] tree is the routed one for
// /vi|en/admin URLs, so the boundary must exist here to keep the shell
// mounted. Same shared component, single hop.
export { default } from '@/components/ui/section-error';
