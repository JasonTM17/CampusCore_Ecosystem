'use client';

import { EventsConsolePage } from '@/components/events/EventsConsolePage';

/**
 * /dashboard/events — student surface plus the staff console for non-admin
 * grant holders. Full admins never reach this route (the dashboard layout
 * bounces them to /admin) — their console is /admin/events.
 */
export default function EventsPage() {
  return <EventsConsolePage />;
}
