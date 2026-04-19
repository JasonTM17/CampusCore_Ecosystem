export type {
  BaseAuthRole as AuthRole,
  AuthUserStudentProfile,
} from '@campuscore/platform-auth';
import type { BaseAuthUser } from '@campuscore/platform-auth';

export interface AuthUser extends BaseAuthUser {
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | null;
  address?: string | null;
  avatar?: string | null;
  status: string;
  createdAt: Date;
}

export interface AuthSessionUser extends AuthUser {
  ipAddress?: string;
  userAgent?: string;
}
