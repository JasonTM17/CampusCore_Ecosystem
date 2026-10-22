/**
 * Hub module registry — publication-policy.md §6.
 *
 * The single place later phases flip `availability` ('available' → link,
 * 'planned' → disabled card with a locale status label, never "hoàn
 * chỉnh"). Audience semantics: `public` = everyone including anonymous;
 * `anonymous` = only without a session; role names = session role required.
 * Planned entries are ecosystem discovery (D3): public-planned modules
 * surface for every visitor, role-gated planned modules for that role.
 */
export type HubAudience = 'public' | 'anonymous' | 'student' | 'lecturer' | 'admin';

export interface HubModule {
  key:
    | 'news'
    | 'docs'
    | 'events'
    | 'library'
    | 'admissions'
    | 'dashboard'
    | 'learning'
    | 'careers'
    | 'lecturer'
    | 'admin'
    | 'login';
  href: string;
  roles: readonly HubAudience[];
  availability: 'available' | 'planned';
}

export const HUB_MODULES: readonly HubModule[] = [
  { key: 'news', href: '/news', roles: ['public'], availability: 'available' },
  { key: 'docs', href: '/docs', roles: ['public'], availability: 'available' },
  { key: 'events', href: '/events', roles: ['public'], availability: 'planned' },
  { key: 'library', href: '/library', roles: ['public'], availability: 'planned' },
  { key: 'admissions', href: '/admissions', roles: ['public'], availability: 'planned' },
  { key: 'dashboard', href: '/dashboard', roles: ['student'], availability: 'available' },
  { key: 'learning', href: '/learning', roles: ['student', 'lecturer'], availability: 'planned' },
  { key: 'careers', href: '/careers', roles: ['student'], availability: 'planned' },
  { key: 'lecturer', href: '/dashboard/lecturer', roles: ['lecturer'], availability: 'available' },
  { key: 'admin', href: '/admin', roles: ['admin'], availability: 'available' },
  { key: 'login', href: '/login?portal=student', roles: ['anonymous'], availability: 'available' },
];

export interface HubViewer {
  signedIn: boolean;
  student: boolean;
  lecturer: boolean;
  admin: boolean;
}

function audienceVisible(role: HubAudience, viewer: HubViewer): boolean {
  switch (role) {
    case 'public':
      return true;
    case 'anonymous':
      return !viewer.signedIn;
    case 'student':
      return viewer.signedIn && viewer.student;
    case 'lecturer':
      return viewer.signedIn && viewer.lecturer;
    case 'admin':
      return viewer.signedIn && viewer.admin;
  }
}

/** Entries in the open section — every visitor sees public modules. */
export function publicHubModules(): HubModule[] {
  return HUB_MODULES.filter((m) => m.roles.includes('public'));
}

/** Entries for the workspace section, filtered by session roles. */
export function workspaceHubModules(viewer: HubViewer): HubModule[] {
  const matches = HUB_MODULES.filter(
    (m) => !m.roles.includes('public') && m.roles.some((r) => audienceVisible(r, viewer)),
  );
  if (viewer.signedIn && matches.length === 0) {
    // Any authenticated account without a specific role still lands somewhere.
    const fallback = HUB_MODULES.find((m) => m.key === 'dashboard');
    return fallback ? [fallback] : [];
  }
  return matches;
}
