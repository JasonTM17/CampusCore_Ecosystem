'use client';

import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandMark } from '@/components/BrandMark';
import { LanguageToggle } from '@/components/LanguageToggle';
import { LocalizedLink } from '@/components/LocalizedLink';
import { LinkButton } from '@/components/ui/link-button';
import { useI18n } from '@/i18n';

/**
 * Shared chrome for the anonymous content lanes (hub/news/docs). Same visual
 * contract as the landing page header; an optional breadcrumb keeps the
 * locale prefix through `useI18n().href(...)`.
 */
export function PublicChrome({ children }: { children: ReactNode }) {
  const { user, isAdmin, isLecturer, isSuperAdmin } = useAuth();
  const { messages } = useI18n();
  const workspaceHref = isAdmin || isSuperAdmin
    ? '/admin'
    : isLecturer
      ? '/dashboard/lecturer'
      : '/dashboard';
  return (
    <div className="marketing-shell min-h-dvh bg-background">
      <header className="bg-portal-sidebar text-portal-sidebar-text">
        <nav className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-2 px-4 sm:px-6 lg:px-12">
          <BrandMark
            href="/hub"
            subtitle={messages.home.navSubtitle}
            compact
            className="min-w-0"
            markClassName="border-0 bg-white p-1 shadow-xs"
            titleClassName="max-sm:sr-only text-portal-sidebar-text"
            subtitleClassName="hidden sm:block text-portal-sidebar-muted"
          />
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <LanguageToggle inverse />
            <ThemeToggle className="text-portal-sidebar-text hover:bg-white/10 hover:text-portal-sidebar-text" />
            {user ? (
              <LinkButton href={workspaceHref} variant="warm" className="inline-flex shrink-0 px-3 sm:px-4">
                {messages.common.actions.openDashboard}
              </LinkButton>
            ) : (
              <LinkButton href="/login?portal=student" variant="warm" className="inline-flex shrink-0 px-3 sm:px-4">
                {messages.common.actions.signIn}
              </LinkButton>
            )}
          </div>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 lg:px-12">
        {children}
      </main>
    </div>
  );
}

/** Locale-aware breadcrumb link back to a parent content lane. */
export function ContentBackLink({ href, label }: { href: string; label: string }) {
  return (
    <LocalizedLink
      href={href}
      className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </LocalizedLink>
  );
}
