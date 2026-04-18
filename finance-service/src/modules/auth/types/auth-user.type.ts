export type AuthRole = string;

export interface AuthUser {
  id: string;
  email: string;
  roles: AuthRole[];
  permissions: string[];
  studentId?: string | null;
  lecturerId?: string | null;
}
