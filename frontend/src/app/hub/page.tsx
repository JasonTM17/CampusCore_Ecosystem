'use client';

import {
  ArrowRight,
  BookOpen,
  Briefcase,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Library,
  LogIn,
  Newspaper,
  Settings,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { LocalizedLink } from '@/components/LocalizedLink';
import { PublicChrome } from '@/components/content/PublicChrome';
import { SectionEyebrow } from '@/components/ui/page-header';
import { useI18n } from '@/i18n';
import {
  publicHubModules,
  workspaceHubModules,
  type HubModule,
} from '@/lib/hub-modules';
import { cn } from '@/lib/utils';

const ICONS: Record<HubModule['key'], typeof Newspaper> = {
  news: Newspaper,
  docs: BookOpen,
  events: CalendarDays,
  library: Library,
  admissions: ClipboardList,
  dashboard: LayoutDashboard,
  learning: GraduationCap,
  careers: Briefcase,
  lecturer: Users,
  admin: Settings,
  login: LogIn,
};

const TONES: Record<HubModule['key'], string> = {
  news: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  docs: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  events: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  library: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  admissions: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  dashboard: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  learning: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  careers: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  lecturer: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  admin: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  login: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

/**
 * Hub — the ecosystem doorway (publication-policy §6). Entries come from the
 * hub-modules registry: available modules link through; planned modules
 * render a disabled status label and never claim completion while flagged.
 */
export default function HubPage() {
  const { user, isStudent, isLecturer, isAdmin, isSuperAdmin } = useAuth();
  const { messages } = useI18n();
  const copy = messages.content.hub;

  const publicEntries = publicHubModules();
  const workspaceEntries = workspaceHubModules({
    signedIn: Boolean(user),
    student: isStudent,
    lecturer: isLecturer,
    admin: isAdmin || isSuperAdmin,
  });

  const renderCard = (entry: HubModule) => {
    const lane = copy.entries[entry.key];
    const Icon = ICONS[entry.key];
    const planned = entry.availability === 'planned';
    return (
      <article
        key={entry.key}
        data-availability={entry.availability}
        className={cn(
          'flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-xs transition',
          planned ? 'opacity-70' : 'hover:border-primary/40 hover:shadow-md',
        )}
      >
        <div className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', TONES[entry.key])}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold text-foreground">{lane.title}</h2>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{lane.description}</p>
        {planned ? (
          <span className="mt-auto inline-flex min-h-10 w-fit items-center rounded-full border border-dashed border-border px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {copy.plannedStatus}
          </span>
        ) : (
          <LocalizedLink
            href={entry.href}
            className="group mt-auto inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copy.open}
            <ArrowRight className="h-4 w-4 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
          </LocalizedLink>
        )}
      </article>
    );
  };

  return (
    <PublicChrome>
      <div className="mb-8 space-y-2">
        <SectionEyebrow>{copy.publicSection}</SectionEyebrow>
        <h1 className="text-3xl font-bold text-foreground">{copy.title}</h1>
        <p className="max-w-2xl text-base text-muted-foreground">{copy.subtitle}</p>
      </div>

      <section aria-labelledby="hub-public" className="mb-10">
        <h2 id="hub-public" className="sr-only">{copy.publicSection}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {publicEntries.map(renderCard)}
        </div>
      </section>

      <section aria-labelledby="hub-workspace">
        <h2 id="hub-workspace" className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {user ? copy.workspaceSection : copy.signInCta}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaceEntries.map(renderCard)}
        </div>
      </section>
    </PublicChrome>
  );
}
