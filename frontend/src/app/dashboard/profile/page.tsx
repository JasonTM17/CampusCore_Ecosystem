'use client';

import { useState } from 'react';
import { Calendar, KeyRound, Mail, MapPin, Phone, Save, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { WorkspacePanel } from '@/components/dashboard/WorkspaceSurface';
import { toast } from 'sonner';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: user?.phone || '',
    dateOfBirth: user?.dateOfBirth
      ? new Date(user.dateOfBirth).toISOString().split('T')[0]
      : '',
    address: user?.address || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setIsLoading(true);

    try {
      await authApi.updateProfile({
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim(),
        dateOfBirth: formData.dateOfBirth || undefined,
        address: formData.address.trim(),
      });
      toast.success('Profile updated');
      await refreshUser();
    } catch {
      const message = 'We could not save your profile changes.';
      setProfileError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordError('');
    setIsUpdatingPassword(true);

    const form = e.currentTarget;
    const oldPassword = (form.elements.namedItem('oldPassword') as HTMLInputElement).value;
    const newPassword = (form.elements.namedItem('newPassword') as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem('confirmPassword') as HTMLInputElement).value;

    if (newPassword !== confirmPassword) {
      setPasswordError('The new password and confirmation must match.');
      setIsUpdatingPassword(false);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Choose a password with at least 8 characters.');
      setIsUpdatingPassword(false);
      return;
    }

    try {
      await authApi.changePassword(oldPassword, newPassword);
      toast.success('Password updated');
      form.reset();
    } catch (error: any) {
      const message =
        error.response?.data?.message || 'We could not update your password.';
      setPasswordError(message);
      toast.error(message);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Account settings</SectionEyebrow>}
        title="Profile settings"
        description="Update personal details, keep contact information current, and rotate credentials without leaving the workspace shell."
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <WorkspacePanel
          title="Account profile"
          description="Keep the account record aligned with the information your campus teams rely on."
          contentClassName="space-y-6"
        >
            <div className="flex flex-col gap-4 rounded-lg border border-border/70 bg-secondary/35 p-5 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
                {user?.firstName?.[0]}
                {user?.lastName?.[0]}
              </div>
              <div className="space-y-1">
                <div className="text-lg font-semibold text-foreground">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="text-sm text-muted-foreground">{user?.email}</div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {user?.roles?.map((role) => (
                    <span
                      key={role}
                      className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {profileError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {profileError}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    First name
                  </label>
                  <Input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) =>
                      setFormData((current) => ({ ...current, firstName: e.target.value }))
                    }
                    icon={<User className="h-4 w-4" />}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Last name
                  </label>
                  <Input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) =>
                      setFormData((current) => ({ ...current, lastName: e.target.value }))
                    }
                    icon={<User className="h-4 w-4" />}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <Input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    icon={<Mail className="h-4 w-4" />}
                    hint="Email is managed through your campus account owner."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Phone</label>
                  <Input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData((current) => ({ ...current, phone: e.target.value }))
                    }
                    placeholder="+66..."
                    icon={<Phone className="h-4 w-4" />}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Date of birth
                  </label>
                  <Input
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) =>
                      setFormData((current) => ({ ...current, dateOfBirth: e.target.value }))
                    }
                    icon={<Calendar className="h-4 w-4" />}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Address</label>
                  <Input
                    type="text"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData((current) => ({ ...current, address: e.target.value }))
                    }
                    placeholder="Street, city, region"
                    icon={<MapPin className="h-4 w-4" />}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={isLoading}>
                  <Save className="mr-2 h-4 w-4" />
                  {isLoading ? 'Saving changes' : 'Save changes'}
                </Button>
              </div>
            </form>
        </WorkspacePanel>

        <div className="space-y-6">
          <WorkspacePanel
            title="Password and session safety"
            description="Use a strong password and expect to sign in again after a successful change."
            variant="muted"
            contentClassName="space-y-4"
          >
              {passwordError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {passwordError}
                </div>
              ) : null}
              <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Current password
                  </label>
                  <Input
                    name="oldPassword"
                    type="password"
                    placeholder="Enter your current password"
                    required
                    icon={<KeyRound className="h-4 w-4" />}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    New password
                  </label>
                  <Input
                    name="newPassword"
                    type="password"
                    placeholder="Choose a new password"
                    required
                    minLength={8}
                    hint="Minimum 8 characters. Use something unique to this account."
                    icon={<KeyRound className="h-4 w-4" />}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Confirm new password
                  </label>
                  <Input
                    name="confirmPassword"
                    type="password"
                    placeholder="Confirm the new password"
                    required
                    minLength={8}
                    icon={<KeyRound className="h-4 w-4" />}
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={isUpdatingPassword}>
                    {isUpdatingPassword ? 'Updating password' : 'Update password'}
                  </Button>
                </div>
              </form>
          </WorkspacePanel>

          <WorkspacePanel
            title="What changes here"
            variant="muted"
            contentClassName="space-y-3 text-sm leading-6 text-muted-foreground"
          >
              <p>
                Profile edits update the browser session view after a successful save.
              </p>
              <p>
                Password rotation stays on the same authenticated route and uses the shared auth contract.
              </p>
              <p>
                Sensitive account ownership fields, such as your email, stay controlled by the service owner instead of an inline edit field.
              </p>
          </WorkspacePanel>
        </div>
      </div>
    </div>
  );
}
