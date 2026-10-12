'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { LocalizedLink } from '@/components/LocalizedLink';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { authApi } from '@/lib/api';
import { campusCodeMessage, campusErrorCode } from '@/lib/campus-error';
import {
  checkPasswordPolicy,
  mapPasswordErrorCode,
  passwordHasLetterAndDigit,
  passwordWithinLimits,
  type PasswordErrorCode,
} from '@/lib/password-policy';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Anonymous one-time token redemption. The token arrives in the query string
 * and is moved into React state on first render, then removed from the
 * address bar so it cannot leak through history, copy-paste, or referrers.
 */
export default function ResetPasswordPage() {
  const { href, messages } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Snapshot the token exactly once — later renders must not resurrect it
  // after the URL has been scrubbed.
  const [token] = useState(() => searchParams.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [tokenInvalid, setTokenInvalid] = useState(!token);
  const [succeeded, setSucceeded] = useState(false);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const invalidTitleRef = useRef<HTMLHeadingElement>(null);
  const copy = messages.resetPassword;

  // Scrub the token from the address bar immediately after it has been
  // captured into state. The page metadata also sets referrer: no-referrer.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('token')) {
      url.searchParams.delete('token');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    if (tokenInvalid) {
      invalidTitleRef.current?.focus();
    }
  }, [tokenInvalid]);

  useEffect(() => {
    if (formError) {
      formErrorRef.current?.focus();
    }
  }, [formError]);

  const checklist = useMemo(
    () => [
      { key: 'length', label: copy.checklist.length, met: passwordWithinLimits(newPassword) },
      { key: 'letterDigit', label: copy.checklist.letterDigit, met: passwordHasLetterAndDigit(newPassword) },
      {
        key: 'match',
        label: copy.checklist.match,
        met: confirmPassword.length > 0 && newPassword === confirmPassword,
      },
    ],
    [newPassword, confirmPassword, copy.checklist],
  );

  const localizeIssue = (issue: PasswordErrorCode): string =>
    messages.common.campusErrors.codes[issue];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || tokenInvalid) return;
    setFormError('');

    const issue = checkPasswordPolicy(newPassword, { confirmPassword });
    if (issue) {
      setFormError(localizeIssue(issue));
      return;
    }

    setIsSaving(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSucceeded(true);
      // Brief success state, then hand off to sign-in. The token has already
      // been consumed server-side; nothing sensitive travels in the redirect.
      window.setTimeout(() => {
        router.push(`${href('/login')}?reset=1`);
      }, 900);
    } catch (error: unknown) {
      const code = campusErrorCode(error);
      if (code === 'RESET_TOKEN_INVALID') {
        setTokenInvalid(true);
      } else if (code === 'RATE_LIMIT_EXCEEDED' ||
          (error instanceof AxiosError && error.response?.status === 429)) {
        setFormError(copy.errors.rateLimited);
      } else if (mapPasswordErrorCode(code)) {
        setFormError(localizeIssue(mapPasswordErrorCode(code)!));
      } else if (error instanceof AxiosError && !error.response) {
        setFormError(messages.common.campusErrors.network);
      } else {
        setFormError(campusCodeMessage(error, messages.common.campusErrors, copy.errors.fallback));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const passwordToggle = (visible: boolean, toggle: () => void, described: string) => (
    <button
      type="button"
      onClick={toggle}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={visible ? messages.login.hidePassword : messages.login.showPassword}
      title={visible ? messages.login.hidePassword : messages.login.showPassword}
      aria-pressed={visible}
      aria-describedby={described}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  return (
    <AuthShell
      portal="student"
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      features={copy.featureTitles.map((label, index) => ({
        label,
        description: copy.featureDescriptions[index],
      }))}
    >
      {tokenInvalid ? (
        <div className="space-y-6">
          <div
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 shadow-sm"
          >
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 space-y-2">
                <h2
                  ref={invalidTitleRef}
                  tabIndex={-1}
                  className="text-lg font-semibold text-foreground focus-visible:outline-none"
                >
                  {copy.invalidTitle}
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {copy.invalidDescription}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <LocalizedLink
              href="/forgot-password"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copy.requestNewLink}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </LocalizedLink>
            <LocalizedLink
              href="/login"
              className="inline-flex min-h-8 items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {copy.backToSignIn}
            </LocalizedLink>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {copy.sectionEyebrow}
            </p>
            <h2 className="text-2xl font-semibold leading-8 text-foreground">
              {copy.heading}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">{copy.subheading}</p>
          </div>

          <div aria-live="polite">
            {succeeded ? (
              <div
                id="reset-success-banner"
                role="status"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] p-4 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-950/30"
              >
                <p className="flex items-start gap-2.5 text-sm font-medium text-emerald-950 dark:text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  {copy.successToast}
                </p>
                <p className="mt-1.5 pl-7 text-xs leading-5 text-emerald-900/90 dark:text-emerald-300/90">
                  {copy.successDescription}
                </p>
              </div>
            ) : null}
          </div>

          {formError ? (
            <div
              id="reset-error"
              ref={formErrorRef}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              {formError}
            </div>
          ) : null}

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
            aria-describedby={formError ? 'reset-error' : undefined}
          >
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-sm font-medium text-foreground">
                {copy.newPassword}
              </label>
              <Input
                id="new-password"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={copy.newPasswordPlaceholder}
                autoComplete="new-password"
                icon={<Lock className="h-4 w-4" />}
                required
                autoFocus
                endAction={passwordToggle(showNew, () => setShowNew((v) => !v), 'new-password')}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
                {copy.confirmPassword}
              </label>
              <Input
                id="confirm-password"
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={copy.confirmPasswordPlaceholder}
                autoComplete="new-password"
                icon={<Lock className="h-4 w-4" />}
                required
                endAction={passwordToggle(showConfirm, () => setShowConfirm((v) => !v), 'confirm-password')}
              />
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/35 p-4">
              <p className="text-xs leading-5 text-muted-foreground">{copy.policyHint}</p>
              <ul className="mt-2.5 space-y-1.5" aria-live="off">
                {checklist.map((item) => (
                  <li
                    key={item.key}
                    data-check={item.key}
                    data-met={item.met ? 'true' : 'false'}
                    className={cn(
                      'flex items-center gap-2 text-xs',
                      item.met ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
                    )}
                  >
                    <CheckCircle2
                      className={cn('h-3.5 w-3.5 shrink-0', item.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/40')}
                      aria-hidden="true"
                    />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>

            <Button type="submit" className="w-full" disabled={isSaving || succeeded}>
              {isSaving ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                  {copy.savePassword}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  {copy.resetPassword}
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground">
            <LocalizedLink
              href="/login"
              className="inline-flex min-h-8 items-center gap-1.5 font-medium text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {copy.backToSignIn}
            </LocalizedLink>
          </p>
        </div>
      )}
    </AuthShell>
  );
}
