'use client';

import * as React from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandMark } from '@/components/BrandMark';
import { SectionEyebrow } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

interface AuthShellFeature {
  label: string;
  description: string;
}

interface AuthShellProps {
  eyebrow: string;
  title: string;
  description: string;
  features: AuthShellFeature[];
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function AuthShell({
  eyebrow,
  title,
  description,
  features,
  children,
  footer,
  className,
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden border-r border-border/80 bg-[hsl(var(--canvas-subtle))] lg:flex">
          <div className="flex w-full items-center px-10 py-12 xl:px-16">
            <div className="mx-auto max-w-xl space-y-10">
              <BrandMark
                href="/"
                subtitle="Campus operations workspace"
                markClassName="bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
              />
              <div className="space-y-4">
                <SectionEyebrow>{eyebrow}</SectionEyebrow>
                <h1 className="max-w-lg text-5xl font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                <p className="max-w-lg text-base leading-7 text-muted-foreground">
                  {description}
                </p>
              </div>
              <div className="grid gap-4">
                {features.map((feature, index) => (
                  <div
                    key={feature.label}
                    className="grid grid-cols-[40px_1fr] gap-4 rounded-lg border border-border/70 bg-card/80 px-5 py-4 shadow-sm"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--foreground))] text-[hsl(var(--background))]">
                      <span className="text-sm font-semibold">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold text-foreground">
                        {feature.label}
                      </h2>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="relative flex items-center justify-center px-5 py-10 sm:px-8 lg:px-10">
          <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
            <ThemeToggle />
          </div>
          <div className={cn('w-full max-w-lg space-y-8', className)}>
            <div className="lg:hidden">
              <BrandMark href="/" subtitle="Academic access" />
            </div>
            {children}
            {footer ? <div>{footer}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
