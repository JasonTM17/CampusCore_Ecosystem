'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface WorkspaceMetricCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon: React.ReactNode;
  detail?: React.ReactNode;
  toneClassName?: string;
  compact?: boolean;
  className?: string;
}

export function WorkspaceMetricCard({
  label,
  value,
  icon,
  detail,
  toneClassName,
  compact = false,
  className,
}: WorkspaceMetricCardProps) {
  return (
    <Card variant="elevated" className={cn('h-full min-w-0', className)}>
      <CardContent
        className={cn(
          'flex h-full flex-col pt-6',
          compact ? 'gap-3' : 'gap-4',
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
              toneClassName,
            )}
          >
            {icon}
          </div>
          <div className="min-w-0 text-right">
            <div
              className={cn(
                'break-words font-semibold tracking-tight text-foreground',
                compact ? 'text-2xl' : 'text-3xl',
              )}
            >
              {value}
            </div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
        </div>
        {detail ? (
          <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface WorkspacePanelProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: 'elevated' | 'muted' | 'default';
  className?: string;
  contentClassName?: string;
}

export function WorkspacePanel({
  title,
  description,
  children,
  footer,
  variant = 'elevated',
  className,
  contentClassName,
}: WorkspacePanelProps) {
  return (
    <Card variant={variant} className={cn('min-w-0', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn('min-w-0', contentClassName)}>{children}</CardContent>
      {footer ? <div className="px-6 pb-6 pt-0">{footer}</div> : null}
    </Card>
  );
}

interface WorkspaceActionTileProps {
  href: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  toneClassName?: string;
  ctaLabel?: React.ReactNode;
  className?: string;
}

export function WorkspaceActionTile({
  href,
  icon,
  title,
  description,
  toneClassName,
  ctaLabel = 'Open workspace',
  className,
}: WorkspaceActionTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group min-w-0 rounded-lg border border-border/70 bg-card px-5 py-5 transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <div className="flex h-full min-w-0 flex-col gap-4">
        <div
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-lg',
            toneClassName,
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 space-y-2">
          <h3 className="text-base font-semibold text-foreground transition-colors group-hover:text-primary">
            {title}
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-2 text-sm font-medium text-primary">
          <span>{ctaLabel}</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}
