'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, RotateCcw } from 'lucide-react';
import { authApi } from '@/lib/api';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionEyebrow } from '@/components/ui/page-header';
import { toast } from 'sonner';

export const dynamic = 'force-dynamic';

const recoveryFeatures = [
  {
    label: 'Verified handoff',
    description:
      'Password recovery stays on the same browser contract as sign-in and session refresh.',
  },
  {
    label: 'Clear next steps',
    description:
      'The screen keeps recovery guidance visible instead of dropping you into a dead end.',
  },
  {
    label: 'Safer messaging',
    description:
      'Responses stay intentionally vague so the flow does not confirm whether an email exists.',
  },
];

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await authApi.forgotPassword(email.trim());
      setEmailSent(true);
      toast.success('If the email exists, a reset link has been sent.');
    } catch {
      toast.error('We could not start password recovery right now.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Password recovery"
      title="Recover account access without guessing."
      description="Use your campus email to request a reset link. The response stays consistent whether the account exists or not."
      features={recoveryFeatures}
      className="max-w-md"
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <SectionEyebrow>Recovery flow</SectionEyebrow>
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              Forgot password
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {emailSent
                ? 'The next step is in your email inbox.'
                : 'Enter your email and we will send password reset instructions.'}
            </p>
          </div>
        </div>

        {emailSent ? (
          <div className="space-y-4 rounded-lg border border-border/70 bg-card/80 p-5">
            <div className="rounded-lg border border-[hsl(var(--success))/0.3] bg-[hsl(var(--success))/0.08] px-4 py-3 text-sm text-foreground">
              If an account matches <strong>{email}</strong>, a reset link is on
              the way.
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Check spam or promotions if you do not see the message right away.
              You can also start over with another address.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEmailSent(false)}
                className="sm:flex-1"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Try another email
              </Button>
              <Link href="/login" className="sm:flex-1">
                <Button variant="default" className="w-full">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Email address
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                autoComplete="email"
                required
                icon={<Mail className="h-4 w-4" />}
                hint="Use the address tied to your campus account."
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Sending reset instructions' : 'Send reset link'}
            </Button>
          </form>
        )}

        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="inline-flex items-center gap-2 font-medium text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
