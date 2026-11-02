/**
 * The bell's notice-board footer is shared by every dashboard role, but the
 * three shells publish different boards: full admins get the admin
 * announcements console, lecturers and faculty heads the lecturer queue,
 * students the student feed. An account outside those shells still gets its
 * own inbox, which every authenticated role can open.
 */
export function noticeBoardHrefFor(
  roles: readonly string[] | null | undefined,
): string {
  if (roles?.includes('ADMIN') || roles?.includes('SUPER_ADMIN')) {
    return '/admin/announcements';
  }
  if (roles?.includes('LECTURER')) {
    return '/dashboard/lecturer/announcements';
  }
  if (roles?.includes('STUDENT')) {
    return '/dashboard/announcements';
  }
  return '/dashboard/notifications';
}
