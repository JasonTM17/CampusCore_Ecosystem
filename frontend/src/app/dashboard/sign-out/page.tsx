'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n';
import { loginHref, portalFromPathname } from '@/lib/login-portal';

export default function DashboardSignOutPage() {
  const { user, isLoading, logout } = useAuth();
  const { href, messages } = useI18n();
  const router = useRouter();
  const didRequestLogout = useRef(false);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!user) {
      // A requested logout already owns the navigation with the correct
      // portal — firing a second replace here would race it with a
      // pathname-derived portal that may not match the user who signed out.
      if (didRequestLogout.current) {
        return;
      }
      router.replace(
        loginHref(href, portalFromPathname(window.location.pathname), 'signed-out'),
      );
      return;
    }

    if (didRequestLogout.current) {
      return;
    }

    didRequestLogout.current = true;
    void logout();
  }, [href, isLoading, logout, router, user]);

  return (
    <div className="rounded-[28px] border border-border/70 bg-card px-6 py-10 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:px-8">
      <div role="status" aria-live="polite" className="flex items-center gap-3">
        <div
          className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
          aria-hidden="true"
        />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {messages.dashboardShell.signOutPage.title}
        </h1>
      </div>
    </div>
  );
}
