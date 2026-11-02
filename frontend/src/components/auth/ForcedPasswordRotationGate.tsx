'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/api';
import { campusCodeMessage } from '@/lib/campus-error';
import { loginHref, portalFromUser } from '@/lib/login-portal';
import { checkPasswordPolicy } from '@/lib/password-policy';
import { authPagesEn, authPagesVi } from '@/i18n/messages-auth';
import { useI18n } from '@/i18n';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Office-issued accounts must rotate their temporary credential before the
 * portal is usable. Both the dashboard shell and the admin frame host this
 * gate so every role is covered; the server additionally rejects business
 * APIs with PASSWORD_CHANGE_REQUIRED, so the overlay is UX, not the gate.
 */
export function ForcedPasswordRotationGate() {
  const { user, logout } = useAuth();
  const { href, locale, messages } = useI18n();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!user || !user.mustChangePassword) {
    return null;
  }

  const copy = (locale === 'vi' ? authPagesVi : authPagesEn).passwordRotation;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const issue = checkPasswordPolicy(newPassword, {
      email: user.email,
      currentPassword: oldPassword,
      confirmPassword,
    });
    if (issue) {
      setError(messages.common.campusErrors.codes[issue] ?? copy.failed);
      return;
    }
    setIsSaving(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      await logout({ redirect: loginHref(href, portalFromUser(user), 'password-rotated') });
    } catch (error: unknown) {
      setError(campusCodeMessage(error, messages.common.campusErrors, copy.failed));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    // A forced security gate: non-dismissible so Escape/backdrop cannot skip
    // the rotation, but still focus-trapped and screen-reader labelled via the
    // shared Modal (role="dialog" + aria-modal).
    <Modal
      isOpen
      onClose={() => {}}
      dismissible={false}
      title={copy.title}
      description={copy.description}
      className="max-w-md"
    >
      <div className="space-y-5">
        <p className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-all">{user.email}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error ? (
            <p id="rotation-error" role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="rotation-current" className="text-sm font-medium text-foreground">
              {copy.currentLabel}
            </label>
            <Input
              id="rotation-current"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'rotation-error' : undefined}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="rotation-new" className="text-sm font-medium text-foreground">
              {copy.newLabel}
            </label>
            <Input
              id="rotation-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'rotation-error rotation-hint' : 'rotation-hint'}
              required
            />
            <p id="rotation-hint" className="text-xs leading-5 text-muted-foreground">{copy.hint}</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="rotation-confirm" className="text-sm font-medium text-foreground">
              {copy.confirmLabel}
            </label>
            <Input
              id="rotation-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'rotation-error' : undefined}
              required
            />
          </div>
          <Button type="submit" disabled={isSaving} className="w-full">
            {isSaving ? copy.saving : copy.submit}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
