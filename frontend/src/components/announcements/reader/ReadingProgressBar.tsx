'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import {
  announcementWorkspaceEn,
  announcementWorkspaceVi,
} from '@/i18n/messages-announcements';

interface ReadingProgressBarProps {
  progress: number; // 0 - 100
  className?: string;
  tone?: string;
  ariaLabel?: string;
  locale?: Locale;
}

export function ReadingProgressBar({
  progress,
  className,
  tone = 'from-blue-600 via-indigo-500 to-primary',
  ariaLabel,
  locale = 'vi',
}: ReadingProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, progress));
  const resolvedAriaLabel =
    ariaLabel ?? { en: announcementWorkspaceEn, vi: announcementWorkspaceVi }[locale].reader.progress.label;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={resolvedAriaLabel}
      className={cn(
        'sticky top-0 z-30 h-1 w-full bg-border/40 overflow-hidden print:hidden',
        className,
      )}
    >
      <div
        className={cn('h-full bg-gradient-to-r transition-[width] duration-150 ease-out', tone)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
