'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { User, Mail, Phone, Calendar, MapPin, Camera, Save } from 'lucide-react';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: user?.phone || '',
    dateOfBirth: user?.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split('T')[0] : '',
    address: user?.address || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await authApi.updateProfile({
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        dateOfBirth: formData.dateOfBirth || undefined,
        address: formData.address,
      });
      toast.success('Profile updated successfully');
      await refreshUser();
    } catch (error) {
      toast.error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold dark:text-white">Profile Settings</h1>
      </div>

      {/* Profile Avatar Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <div className="relative">
              <div className="h-32 w-32 rounded-full bg-primary flex items-center justify-center text-white text-3xl font-bold">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <button
                type="button"
                className="absolute bottom-0 right-0 p-2 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700"
                aria-label="Upload profile photo"
                title="Upload profile photo"
              >
                <Camera className="h-4 w-4 dark:text-white" />
              </button>
            </div>
            <div>
              <h2 className="text-xl font-semibold dark:text-white">{user?.firstName} {user?.lastName}</h2>
              <p className="text-gray-500 dark:text-gray-400">{user?.email}</p>
              <div className="flex gap-2 mt-2">
                {user?.roles?.map((role) => (
                  <span key={role} className="px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded">
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Form */}
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>Update your personal details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-gray-200">First Name</label>
                <Input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  icon={<User className="h-4 w-4" />}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-gray-200">Last Name</label>
                <Input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  icon={<User className="h-4 w-4" />}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-gray-200">Email</label>
                <Input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  icon={<Mail className="h-4 w-4" />}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-gray-200">Phone</label>
                <Input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+1234567890"
                  icon={<Phone className="h-4 w-4" />}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-gray-200">Date of Birth</label>
                <Input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  icon={<Calendar className="h-4 w-4" />}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-gray-200">Address</label>
                <Input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="123 Main St, City"
                  icon={<MapPin className="h-4 w-4" />}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isLoading}>
                <Save className="h-4 w-4 mr-2" />
                {isLoading ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Change Password Card */}
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Update your password</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const form = e.target as HTMLFormElement;
            const oldPassword = (form.elements.namedItem('oldPassword') as HTMLInputElement).value;
            const newPassword = (form.elements.namedItem('newPassword') as HTMLInputElement).value;
            const confirmPassword = (form.elements.namedItem('confirmPassword') as HTMLInputElement).value;

            if (newPassword !== confirmPassword) {
              toast.error('New passwords do not match');
              return;
            }

            if (newPassword.length < 6) {
              toast.error('Password must be at least 6 characters');
              return;
            }

            try {
              await authApi.changePassword(oldPassword, newPassword);
              toast.success('Password updated successfully');
              form.reset();
            } catch (error: any) {
              toast.error(error.response?.data?.message || 'Failed to update password');
            }
          }}>
            <div className="space-y-2">
              <label className="text-sm font-medium dark:text-gray-200">Current Password</label>
              <Input name="oldPassword" type="password" placeholder="Enter current password" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium dark:text-gray-200">New Password</label>
              <Input name="newPassword" type="password" placeholder="Enter new password" required minLength={6} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium dark:text-gray-200">Confirm New Password</label>
              <Input name="confirmPassword" type="password" placeholder="Confirm new password" required minLength={6} />
            </div>
            <div className="flex justify-end">
              <Button type="submit">
                Update Password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
