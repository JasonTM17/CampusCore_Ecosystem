'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';

interface AdminFrameProps {
  title: string;
  description: string;
  eyebrow?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminFrame({
  title,
  description,
  eyebrow = 'Admin workspace',
  backHref = '/admin',
  backLabel = 'Back to admin dashboard',
  actions,
  children,
}: AdminFrameProps) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <BrandMark href="/admin" compact />
            <Link
              href={backHref}
              className="hidden items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
              aria-label={backLabel}
              title={backLabel}
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden text-sm text-muted-foreground md:block">
              {user?.firstName}
            </div>
            <Button type="button" variant="outline" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow={<SectionEyebrow>{eyebrow}</SectionEyebrow>}
          title={title}
          description={description}
          actions={actions}
        />
        <div className="pt-8">{children}</div>
      </main>
    </div>
  );
}
