export type AuthRole = string;

export interface AuthUserStudentProfile {
  year?: number | null;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: AuthRole[];
  permissions: string[];
  studentId?: string | null;
  lecturerId?: string | null;
  student?: AuthUserStudentProfile | null;
}
