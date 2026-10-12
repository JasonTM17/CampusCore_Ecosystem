/**
 * Mirrors the backend ceiling in `AdminUserMutationService`
 * (`SUPER_ADMIN_ONLY_ROLES`): a plain administrator may not mutate an
 * account holding one of these roles — the row actions stay disabled and
 * the API independently enforces the same limit with 403 ROLE_ESCALATION.
 */
const SUPER_ADMIN_ONLY_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'TRUONG_KHOA']);

export function isPrivilegedAccountTarget(
  roles: readonly string[] | null | undefined,
): boolean {
  return (roles ?? []).some((role) => SUPER_ADMIN_ONLY_ROLES.has(role.trim().toUpperCase()));
}
