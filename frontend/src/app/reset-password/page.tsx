'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Lock } from 'lucide-react';
import { authApi } from '@/lib/api';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, LoadingState } from '@/components/ui/state-block';
import { SectionEyebrow } from '@/components/ui/page-header';
import { toast } from 'sonner';

export const dynamic = 'force-dynamic';

const resetFeatures = [
  {
    label: 'One secure path',
    description:
      'Reset tokens move back into the same protected sign-in flow instead of branching into a separate experience.',
  },
  {
    label: 'Clear requirements',
    description:
      'Users see password guidance and validation before the form submits.',
  },
  {
    label: 'Consistent recovery',
    description:
      'Expired or invalid tokens render a stable recovery state instead of a broken page.',
  },
];

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (password !== confirmPassword) {
      setFormError('The new password and confirmation must match.');
      return;
    }

    if (password.length < 8) {
      setFormError('Choose a password with at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.resetPassword(token!, password);
      toast.success('Password reset complete');
      router.push('/login');
    } catch (error: any) {
      const message =
        error.response?.data?.message || 'We could not reset your password.';
      setFormError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Set a new password and get back into CampusCore."
      description="Choose a fresh password for your campus account. Once complete, you will sign in again with the updated credentials."
      features={resetFeatures}
      className="max-w-md"
    >
      {!token ? (
        <EmptyState
          title="This reset link is no longer valid"
          description="Request a new password reset link and use the latest email to continue."
          action={
            <Link href="/forgot-password">
              <Button>Request a new reset link</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <SectionEyebrow>New password</SectionEyebrow>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                Reset password
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Use a password you have not used recently and keep it unique to
                your campus account.
              </p>
            </div>
          </div>

          {formError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                New password
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a new password"
                  autoComplete="new-password"
                  icon={<Lock className="h-4 w-4" />}
                  required
                  hint="Minimum 8 characters."
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Confirm password
              </label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm the new password"
                autoComplete="new-password"
                icon={<Lock className="h-4 w-4" />}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Saving new password' : 'Reset password'}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="inline-flex items-center gap-2 font-medium text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </p>
        </div>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading password reset flow" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
