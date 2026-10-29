'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  ClipboardList,
  Library,
  type LucideIcon,
} from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { LocalizedLink } from '@/components/LocalizedLink';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/state-block';
import { useI18n } from '@/i18n';
import type { Locale } from '@/i18n/config';
import { admissionsMessages } from '@/i18n/admissions-messages';
import { careerMessages } from '@/i18n/careers-messages';
import { libraryMessages } from '@/i18n/library-messages';
import { staffMessages } from '@/i18n/staff-messages';
import {
  probeStaffDesks,
  STAFF_DESKS,
  type StaffDeskKey,
} from '@/lib/staff-desks';

const DESK_ICONS: Record<StaffDeskKey, LucideIcon> = {
  admissions: ClipboardList,
  careers: Briefcase,
  library: Library,
};

function deskCopy(key: StaffDeskKey, locale: Locale) {
  if (key === 'admissions') {
    const copy = admissionsMessages[locale];
    return { title: copy.staffTitle, description: copy.staffDescription };
  }
  if (key === 'careers') {
    const copy = careerMessages[locale];
    return { title: copy.deskTitle, description: copy.deskDescription };
  }
  const copy = libraryMessages[locale];
  return { title: copy.deskTitle, description: copy.deskDescription };
}

/**
 * Staff desk start page: lists only the desks whose server-side grant probe
 * answered for the signed-in session. Destinations keep their own scoped
 * authorization; the page never reads applicant, borrower, or candidate rows.
 */
export function StaffDesksPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  const { locale, messages } = useI18n();
  const copy = staffMessages[locale];
  const [desks, setDesks] = useState<StaffDeskKey[]>([]);
  const [failed, setFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setFailed(false);
    const access = await probeStaffDesks();
    setDesks(access.desks);
    setFailed(access.probeFailed);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }
    void load();
  }, [authLoading, user, load]);

  if (authLoading || isLoading) {
    return <LoadingState />;
  }

  if (failed) {
    return (
      <div className="space-y-8" data-testid="staff-desks-page">
        <PageHeader title={copy.title} />
        <ErrorState
          title={copy.failed}
          description={copy.failedHint}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  // Same access-denied surface the desks render for a non-grantee.
  if (desks.length === 0) {
    return <WorkspaceForbiddenState />;
  }

  return (
    <div className="space-y-8" data-testid="staff-desks-page">
      <PageHeader title={copy.title} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STAFF_DESKS.filter((desk) => desks.includes(desk.key)).map((desk) => {
          const Icon = DESK_ICONS[desk.key];
          const lane = deskCopy(desk.key, locale);
          return (
            <article
              key={desk.key}
              data-testid={`staff-desk-${desk.key}`}
              className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-xs transition hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="text-lg font-semibold text-foreground">{lane.title}</h2>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{lane.description}</p>
              <LocalizedLink
                href={desk.href}
                className="group mt-auto inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {messages.content.hub.open}
                <ArrowRight className="h-4 w-4 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
              </LocalizedLink>
            </article>
          );
        })}
      </div>
    </div>
  );
}
