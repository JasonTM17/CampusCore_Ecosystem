'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminFrame } from '@/components/admin/AdminFrame';
import { EventsConsolePage } from '@/components/events/EventsConsolePage';
import { useAuth } from '@/context/AuthContext';
import { adminOpsEn, adminOpsVi } from '@/i18n/messages-admin-ops';
import { useI18n } from '@/i18n';

/**
 * /admin/events — the staff console for `STAFF:events` grant holders. Full
 * admins land here because the dashboard layout bounces them to /admin;
 * the same console serves students + non-admin grant holders at
 * /dashboard/events. Non-admins are redirected to that surface — the
 * admin shell chrome must not wrap a non-admin audience.
 */
export default function AdminEventsPage() {
  const { locale } = useI18n();
  const { isAdmin, isSuperAdmin, isLoading } = useAuth();
  const router = useRouter();
  const fullAdminAccess = isAdmin || isSuperAdmin;

  useEffect(() => {
    if (!isLoading && !fullAdminAccess) {
      router.replace('/dashboard/events');
    }
  }, [isLoading, fullAdminAccess, router]);

  if (!fullAdminAccess) {
    return null;
  }

  return (
    <AdminFrame
      title={(locale === 'vi' ? adminOpsVi : adminOpsEn).events.header.title}
      description={(locale === 'vi' ? adminOpsVi : adminOpsEn).events.header.description}
    >
      <EventsConsolePage />
    </AdminFrame>
  );
}
