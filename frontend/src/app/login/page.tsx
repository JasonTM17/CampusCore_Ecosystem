'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { User } from '@/types/api';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionEyebrow } from '@/components/ui/page-header';
import { getLocalEdgeOrigin, isLocalPreviewHost } from '@/lib/site';
import { toast } from 'sonner';

export const dynamic = 'force-dynamic';

function getPostLoginRoute(user: User) {
  const roles = user.roles ?? (user.role ? [user.role] : []);

  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) {
    return '/admin';
  }

  if (roles.includes('LECTURER')) {
    return '/dashboard/lecturer';
  }

  return '/dashboard';
}

const authFeatures = [
  {
    label: 'Role-aware access',
    description:
      'Admins, lecturers, and students land in the right workspace without a second sign-in step.',
  },
  {
    label: 'Session protection',
    description:
      'Browser auth stays on cookie sessions with CSRF protection and refresh handling.',
  },
  {
    label: 'Operational continuity',
    description:
      'Core academic, finance, engagement, and analytics flows stay reachable from one portal.',
  },
];

const reasonMessages: Record<string, { title: string; body: string }> = {
  'session-expired': {
    title: 'Your session ended',
    body: 'Sign in again to continue working in CampusCore.',
  },
  unauthorized: {
    title: 'Sign in required',
    body: 'Your last request needed an active session.',
  },
  'signed-out': {
    title: 'Signed out',
    body: 'You have been signed out of the workspace.',
  },
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  const [formError, setFormError] = useState('');
  const [runtimeNotice, setRuntimeNotice] = useState<{
    tone: 'info' | 'warning';
    title: string;
    body: string;
  } | null>(null);
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!isLocalPreviewHost(window.location.hostname)) {
      setRuntimeNotice(null);
      return;
    }

    const localEdgeOrigin = getLocalEdgeOrigin();
    const usingPreviewServer = window.location.origin !== localEdgeOrigin;

    if (!usingPreviewServer) {
      setRuntimeNotice(null);
      return;
    }

    let cancelled = false;

    const checkRuntime = async () => {
      try {
        const response = await fetch('/health', {
          cache: 'no-store',
        });

        if (cancelled) {
          return;
        }

        if (response.ok) {
          setRuntimeNotice({
            tone: 'info',
            title: 'Development preview',
            body: 'This local frontend is using the edge proxy. If sign-in stops responding, start the local edge helper or use the public domain.',
          });
          return;
        }

        setRuntimeNotice({
          tone: 'warning',
          title: 'Local edge unavailable',
          body: `This preview cannot reach the local edge right now. Start the edge helper on ${localEdgeOrigin} or use the public domain instead of relying on frontend-only preview mode.`,
        });
      } catch {
        if (!cancelled) {
          setRuntimeNotice({
            tone: 'warning',
            title: 'Local edge unavailable',
            body: `This preview cannot reach the local edge right now. Start the edge helper on ${localEdgeOrigin} or use the public domain instead of relying on frontend-only preview mode.`,
          });
        }
      }
    };

    void checkRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  const reason = searchParams.get('reason') ?? '';
  const notice = useMemo(() => reasonMessages[reason], [reason]);

  const getLoginErrorMessage = (error: unknown) => {
    if (!(error instanceof AxiosError)) {
      return 'We could not sign you in right now.';
    }

    if (!error.response) {
      return 'CampusCore could not reach the local edge or auth services. Start the edge helper, confirm the proxy target is healthy, or use the public domain.';
    }

    if (error.response.status === 401) {
      return 'The email address or password is incorrect.';
    }

    if (error.response.status === 403) {
      return 'This sign-in attempt was blocked. Refresh the page and try again.';
    }

    if (error.response.status >= 500) {
      return 'Sign-in is temporarily unavailable. Please try again in a moment.';
    }

    return error.response?.data?.message || 'We could not sign you in right now.';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsLoading(true);

    try {
      const user = await login(email.trim(), password);
      toast.success('Welcome back');
      router.push(getPostLoginRoute(user));
    } catch (error: unknown) {
      const message = getLoginErrorMessage(error);
      setFormError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Secure access"
      title="Sign in to the campus workspace."
      description="Use the same protected browser session to move across academics, finance, announcements, and operational dashboards."
      features={authFeatures}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <SectionEyebrow>Account access</SectionEyebrow>
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              Welcome back
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Sign in with your campus account to continue.
            </p>
          </div>
        </div>

        {notice ? (
          <div className="rounded-lg border border-border/80 bg-secondary/50 px-4 py-3">
            <div className="text-sm font-semibold text-foreground">
              {notice.title}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {notice.body}
            </div>
          </div>
        ) : null}

        {runtimeNotice ? (
          <div
            className={`rounded-lg px-4 py-3 ${
              runtimeNotice.tone === 'warning'
                ? 'border border-amber-500/30 bg-amber-500/10'
                : 'border border-border/80 bg-secondary/40'
            }`}
          >
            <div className="text-sm font-semibold text-foreground">
              {runtimeNotice.title}
            </div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              {runtimeNotice.body}
            </div>
          </div>
        ) : null}

        {formError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-foreground"
            >
              Email address
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
              autoComplete="email"
              icon={<Mail className="h-4 w-4" />}
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="password"
                className="text-sm font-medium text-foreground"
              >
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                icon={<Lock className="h-4 w-4" />}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                disabled={!isClientReady}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading || !isClientReady}>
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                Signing in
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                Sign in
                <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </Button>
        </form>

        <div className="rounded-lg border border-border/70 bg-card/70 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--foreground))] text-[hsl(var(--background))]">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">
                Session behavior
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                CampusCore uses cookie-based browser sessions with automatic refresh handling and CSRF protection for mutating requests.
              </p>
            </div>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Need a different starting point?{' '}
          <Link href="/" className="font-medium text-primary hover:underline">
            Return to the homepage
          </Link>
          .
        </p>
      </div>
    </AuthShell>
  );
}
