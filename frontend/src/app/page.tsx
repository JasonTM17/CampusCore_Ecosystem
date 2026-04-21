'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  GraduationCap,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionEyebrow } from '@/components/ui/page-header';
import { buildSiteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

const operationalPillars = [
  {
    icon: ShieldCheck,
    title: 'Identity you can trust',
    description:
      'Cookie-based sessions, CSRF protection, and role-aware routing stay intact across the web client.',
  },
  {
    icon: BookOpen,
    title: 'Academic workflows',
    description:
      'Registration, schedules, grades, transcript views, and section operations live behind clear service boundaries.',
  },
  {
    icon: BarChart3,
    title: 'Operational visibility',
    description:
      'Dashboards and reporting move through analytics ownership instead of leaking through unrelated domains.',
  },
  {
    icon: UsersRound,
    title: 'People ownership',
    description:
      'Student and lecturer records remain readable through the frontend without dragging the UI back into a monolith.',
  },
  {
    icon: CalendarRange,
    title: 'Release discipline',
    description:
      'Compose, Kustomize, CI, registry publishing, and edge checks all point at the same 9-image topology.',
  },
  {
    icon: GraduationCap,
    title: 'Campus-ready shell',
    description:
      'One portal for students, lecturers, and admins with sharper states, fewer dead ends, and calmer navigation.',
  },
];

const deliveryChecks = [
  'Dedicated auth, analytics, finance, academic, engagement, and people services',
  'Next.js frontend with cookie session refresh and CSRF-safe mutations',
  'Compose and Kubernetes-first runtime validation',
  'Public edge keeps internal contracts blocked from the browser',
];

const homepageStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'CampusCore',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: buildSiteUrl('/'),
  description:
    'CampusCore is a campus operations workspace for identity, academics, finance, engagement, people data, and analytics.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
};

export default function HomePage() {
  const { user, isLoading } = useAuth();
  const currentYear = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageStructuredData),
        }}
      />
      <nav className="border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark href="/" subtitle="Campus operations workspace" compact />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {!isLoading &&
              (user ? (
                <Link href="/dashboard">
                  <Button>
                    Open dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <Link href="/login">
                  <Button variant="outline">Sign in</Button>
                </Link>
              ))}
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="space-y-8">
            <div className="space-y-4">
              <SectionEyebrow>CampusCore platform</SectionEyebrow>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Academic operations that feel steady, not stitched together.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                CampusCore brings identity, academics, finance, engagement,
                people data, and analytics into one web workspace while keeping
                the service boundaries and release discipline visible.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link href={user ? '/dashboard' : '/login'}>
                <Button size="lg">
                  {user ? 'Continue to workspace' : 'Sign in to workspace'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href={user ? '/admin' : '/login'}>
                <Button size="lg" variant="outline">
                  Review admin surfaces
                </Button>
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Card variant="muted">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Kubernetes-ready</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Local Docker Desktop and release-verified Kustomize paths stay aligned.
                  </p>
                </CardContent>
              </Card>
              <Card variant="muted">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Security-first</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Session refresh, CSRF headers, and internal-edge denial remain in place.
                  </p>
                </CardContent>
              </Card>
              <Card variant="muted">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Operational clarity</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">
                    The UI maps to clear owners instead of collapsing everything back into core.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card variant="elevated" className="overflow-hidden">
            <div className="orbital-divider h-px w-full" />
            <CardHeader className="space-y-3">
              <SectionEyebrow>Runtime snapshot</SectionEyebrow>
              <CardTitle className="text-2xl">
                Verified delivery without hiding the moving parts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3">
                {deliveryChecks.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-[hsl(var(--success))]" />
                    <p className="text-sm leading-6 text-muted-foreground">{item}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-border/70 bg-secondary/45 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Primary access
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Students, lecturers, and admins enter through one consistent browser contract.
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Release posture
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Registry publishing, image verification, and local K8s flows stay traceable.
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="border-y border-border/70 bg-canvas-subtle">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mb-10 max-w-3xl space-y-3">
            <SectionEyebrow>What the portal is built to do</SectionEyebrow>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              One frontend language across the critical campus workflows
            </h2>
            <p className="text-base leading-7 text-muted-foreground">
              The interface is designed for live campus operations, with better
              defaults for auth, data states, and role-aware tasks.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {operationalPillars.map((pillar) => (
              <Card key={pillar.title} variant="default" className="h-full">
                <CardContent className="flex h-full flex-col gap-4 pt-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--foreground))] text-[hsl(var(--background))]">
                    <pillar.icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-foreground">
                      {pillar.title}
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {pillar.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-[hsl(var(--foreground))] text-[hsl(var(--background))]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-[1.2fr_1fr_1fr]">
            <div className="space-y-3">
              <BrandMark
                href="/"
                compact
                markClassName="bg-[hsl(var(--background))] text-[hsl(var(--foreground))] border-transparent"
                titleClassName="text-[hsl(var(--background))]"
                subtitle="Operational workspace"
              />
              <p className="max-w-sm text-sm leading-6 text-[hsl(var(--background))/0.72]">
                A microservices-oriented campus platform focused on stable browser auth,
                clearer service ownership, and verified runtime delivery.
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[hsl(var(--background))/0.65]">
                Workspace
              </h3>
              <div className="space-y-2 text-sm text-[hsl(var(--background))/0.8]">
                <div>Student access</div>
                <div>Lecturer workflows</div>
                <div>Admin operations</div>
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[hsl(var(--background))/0.65]">
                Delivery
              </h3>
              <div className="space-y-2 text-sm text-[hsl(var(--background))/0.8]">
                <div>Compose and K8s</div>
                <div>Semver image releases</div>
                <div>Edge and security verification</div>
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-white/10 pt-6 text-sm text-[hsl(var(--background))/0.7]">
            &copy; {currentYear} CampusCore. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
