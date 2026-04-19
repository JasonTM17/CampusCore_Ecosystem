export type {
  BaseAuthRole as AuthRole,
  AuthUserStudentProfile as PlatformAuthUserStudentProfile,
} from '@campuscore/platform-auth';
import type {
  AuthUserStudentProfile,
  BaseAuthUser,
} from '@campuscore/platform-auth';
export interface AuthUser extends BaseAuthUser {
  firstName?: string;
  lastName?: string;
  student?: AuthUserStudentProfile | null;
}
