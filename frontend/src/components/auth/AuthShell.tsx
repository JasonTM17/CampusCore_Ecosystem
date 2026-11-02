'use client';

import * as React from 'react';
import { BrandMark } from '@/components/BrandMark';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useI18n } from '@/i18n';
import type { LoginPortal } from '@/lib/login-portal';
import { cn } from '@/lib/utils';

interface AuthShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  portal?: LoginPortal;
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  className,
  portal = 'student',
}: AuthShellProps) {
  const { messages } = useI18n();
  const isAdmin = portal === 'admin';
  const isDean = portal === 'dean';
  const isLecturer = portal === 'lecturer';

  return (
    <div
      className={cn(
        'marketing-shell min-h-screen bg-background',
        isAdmin && 'bg-portal-canvas',
      )}
      data-login-portal={portal}
    >
      <a href="#main-content" className="portal-skip-link">
        {messages.home.skipToContent}
      </a>
      <div
        className={cn(
          'grid min-h-screen',
          isAdmin ? 'lg:grid-cols-[1.05fr_0.95fr]' : 'lg:grid-cols-[0.9fr_1.1fr]',
        )}
      >
        <section
          className={cn(
            'portal-sidebar relative hidden overflow-hidden border-r border-white/10 lg:flex',
            isAdmin && 'bg-portal-sidebar-strong',
          )}
        >
          <div className="flex w-full items-center px-10 py-12 xl:px-16">
            <div className="mx-auto w-full max-w-xl space-y-10">
              <BrandMark
                href="/"
                subtitle={
                  isAdmin
                    ? messages.authShell.adminSubtitle
                    : isDean
                      ? messages.authShell.deanSubtitle
                      : isLecturer
                        ? messages.authShell.lecturerSubtitle
                        : messages.authShell.desktopSubtitle
                }
                markClassName="border-0 bg-white p-1 shadow-xs"
                titleClassName="text-portal-sidebar-text"
                subtitleClassName="text-portal-sidebar-muted"
              />
              <div className="space-y-4 border-l-4 border-portal-chrome-accent pl-6">
                <h1 className="max-w-lg text-4xl font-semibold leading-[1.18] text-portal-sidebar-text xl:text-[2.75rem]">
                  {title}
                </h1>
                <p className="max-w-lg text-base leading-7 text-portal-sidebar-muted">
                  {description}
                </p>
              </div>
            </div>
          </div>
        </section>

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'relative flex items-center justify-center px-5 py-20 sm:px-8 lg:px-12',
            isAdmin && 'bg-portal-ribbon',
          )}
        >
          <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          <div className={cn('w-full max-w-md space-y-8 border-0 bg-transparent p-0 sm:rounded-2xl sm:border sm:border-border/80 sm:bg-card sm:p-8 sm:shadow-lg sm:panel-shadow', className)}>
            <div className="border-b border-border/70 pb-6 lg:hidden">
              <BrandMark
                href="/"
                subtitle={
                  isAdmin
                    ? messages.authShell.adminSubtitle
                    : isDean
                      ? messages.authShell.deanSubtitle
                      : isLecturer
                        ? messages.authShell.lecturerSubtitle
                        : messages.authShell.mobileSubtitle
                }
              />
            </div>
            <h1 className="sr-only lg:hidden">{title}</h1>
            {children}
            {footer ? <div>{footer}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
