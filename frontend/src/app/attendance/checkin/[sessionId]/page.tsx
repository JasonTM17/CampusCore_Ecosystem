'use client';

import { useParams } from 'next/navigation';
import { Smartphone, TriangleAlert } from 'lucide-react';
import {
  buildCheckinDeepLink,
  isValidAttendanceSessionId,
} from '@/lib/attendance-checkin';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

// The page reads the locale/routing headers middleware stamps per request —
// it must never be statically prerendered or the wrong dictionary ships.
export const dynamic = 'force-dynamic';

/**
 * Public deep-link landing: the https link a lecturer shares opens here when
 * the CampusUTE app is not installed. The page validates the session id,
 * explains the app-only check-in and hands off via the custom scheme. It
 * fetches nothing and can never perform a check-in — browser geolocation is
 * spoofable, so the web deliberately offers no check-in form.
 */
export default function AttendanceCheckinLandingPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';
  const { messages } = useI18n();
  const copy = messages.attendanceGeofence.landing;

  const valid = isValidAttendanceSessionId(sessionId);
  const deepLink = valid ? buildCheckinDeepLink(sessionId) : null;

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
      data-testid="checkin-landing"
    >
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-8 text-center shadow-sm sm:p-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Smartphone className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-foreground sm:text-2xl">
          {valid ? copy.title : copy.invalidTitle}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {valid ? copy.body : copy.invalidBody}
        </p>
        {valid && deepLink ? (
          <>
            <Button asChild className="mt-6 w-full sm:w-auto">
              <a href={deepLink} data-testid="checkin-deep-link">
                {copy.openButton}
              </a>
            </Button>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              {copy.howTo}
            </p>
          </>
        ) : (
          <p
            role="alert"
            className="mx-auto mt-6 inline-flex items-center gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm font-medium text-status-warning-foreground"
          >
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            {copy.invalidTitle}
          </p>
        )}
      </div>
    </main>
  );
}
