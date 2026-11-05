'use client';

import { useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { ArrowLeft, ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { LocalizedLink } from '@/components/LocalizedLink';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { authApi } from '@/lib/api';
import { campusErrorCode } from '@/lib/campus-error';

export const dynamic = 'force-dynamic';

type ForgotPasswordOutcome = 'sent' | 'rate-limited' | 'network' | 'failed';

/**
 * Classifies a reset-request failure without ever answering "does this mailbox
 * exist?". The Java endpoint already returns 200 for every address, but a proxy
 * or a future lookup could answer a lookup-status 4xx for an unknown account;
 * those answers are folded into the same uniform confirmation. Conditions that
 * say nothing about the mailbox stay visible instead of faking a success: a
 * transport failure, a rate limit, a gate/config rejection (401/403), and a
 * 5xx outage.
 */
function forgotPasswordOutcome(error: unknown): ForgotPasswordOutcome {
  if (campusErrorCode(error) === 'RATE_LIMIT_EXCEEDED') {
    return 'rate-limited';
  }
  if (!(error instanceof AxiosError)) {
    return 'failed';
  }
  const status = error.response?.status;
  if (status === undefined) {
    return 'network';
  }
  if (status === 429) {
    return 'rate-limited';
  }
  // Authorization and gate rejections are infrastructure answers, not mailbox
  // answers: hiding a CSRF/WAF block behind "check your email" would strand the
  // user waiting for a message that was never queued.
  if (status === 401 || status === 403) {
    return 'failed';
  }
  if (status >= 500) {
    return 'failed';
  }
  // A lookup answer (400/404/409/422) must never become an existence oracle.
  return 'sent';
}

/**
 * Anonymous self-service recovery. The backend answers every eligible request
 * with the same 200 body, so the UI shows one generic banner for any accepted
 * submit — it must never distinguish "account exists" from "no account".
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState('');
  const formErrorRef = useRef<HTMLDivElement>(null);
  const sentBannerRef = useRef<HTMLDivElement>(null);
  const { messages } = useI18n();
  const copy = messages.forgotPassword;

  useEffect(() => {
    if (formError) {
      formErrorRef.current?.focus();
    }
  }, [formError]);

  useEffect(() => {
    if (sent) {
      sentBannerRef.current?.focus();
    }
  }, [sent]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSending) return;
    setFormError('');
    setSent(false);
    setIsSending(true);

    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (error: unknown) {
      const outcome = forgotPasswordOutcome(error);
      if (outcome === 'sent') {
        // A lookup-status answer (400/404/409/422) is accepted like a 200: the
        // banner copy is conditional ("If an account matches …"), so it
        // confirms nothing about the mailbox.
        setSent(true);
      } else if (outcome === 'rate-limited') {
        setFormError(copy.rateLimited);
      } else if (outcome === 'network') {
        setFormError(messages.common.campusErrors.network);
      } else {
        setFormError(copy.failedToast);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <AuthShell
      portal="student"
      title={copy.title}
      description={copy.description}
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold leading-8 text-foreground">
            {copy.heading}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {sent ? copy.afterSend : copy.beforeSend}
          </p>
        </div>

        <div aria-live="polite">
          {sent ? (
            <div
              ref={sentBannerRef}
              id="forgot-sent-banner"
              role="status"
              tabIndex={-1}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] p-4 shadow-sm focus-visible:outline-none dark:border-emerald-500/30 dark:bg-emerald-950/30"
            >
              <p className="flex items-start gap-2.5 text-sm font-medium text-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {copy.sentBanner.replace('{email}', email.trim())}
              </p>
              <p className="mt-1.5 pl-7 text-xs leading-5 text-emerald-900/90 dark:text-emerald-300/90">
                {copy.sentDescription}
              </p>
            </div>
          ) : null}
        </div>

        {formError ? (
          <div
            id="forgot-error"
            ref={formErrorRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-status-danger-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            {formError}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="space-y-5"
          aria-describedby={formError ? 'forgot-error' : undefined}
        >
          <div className="space-y-2">
            <label htmlFor="forgot-email" className="text-sm font-medium text-foreground">
              {copy.emailLabel}
            </label>
            <Input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={copy.emailPlaceholder}
              autoComplete="email"
              icon={<Mail className="h-4 w-4" />}
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError
                ? 'forgot-email-hint forgot-error'
                : 'forgot-email-hint'}
              required
            />
            <p id="forgot-email-hint" className="text-xs leading-5 text-muted-foreground">{copy.emailHint}</p>
          </div>

          <Button type="submit" className="w-full" disabled={isSending}>
            {isSending ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                {copy.sendingResetInstructions}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                {copy.sendResetLink}
                <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground">
          <LocalizedLink
            href="/login"
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {copy.backToSignIn}
          </LocalizedLink>
        </p>
      </div>
    </AuthShell>
  );
}
