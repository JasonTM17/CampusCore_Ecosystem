export type AuthRole = string;

export interface AuthUserStudentProfile {
  year?: number | null;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | null;
  address?: string | null;
  avatar?: string | null;
  status: string;
  createdAt: Date;
  roles: AuthRole[];
  permissions: string[];
  studentId?: string | null;
  lecturerId?: string | null;
  student?: AuthUserStudentProfile | null;
}

export interface AuthSessionUser extends AuthUser {
  ipAddress?: string;
  userAgent?: string;
}
