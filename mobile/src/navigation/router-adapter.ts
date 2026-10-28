import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { NO_CAPABILITIES } from '../auth/capabilities';
import { lanePathFor, pathFor, roleHomePath } from './route-map';
import type { MobileNavigation, MobileNavigationOptions } from './types';
import { canAccessLaneScreen, type LaneScreenId, type ScreenName, type UserRole } from './routes';
import { useSession } from '../session/SessionContext';

/**
 * MobileNavigation implementation over expo-router (mobile-policy §2). The
 * legacy screens keep calling `navigation.navigate('grades', …)` — this
 * adapter translates those calls into guarded router paths through the same
 * compat map the deep-link guard uses, so both directions share one
 * authority (route-map.ts).
 */
export function useMobileNavigation(): MobileNavigation {
  const router = useRouter();
  const session = useSession();

  const navigate = useCallback((route: ScreenName, options?: MobileNavigationOptions) => {
    const params: Record<string, string> = {};
    if (options?.thesisTopicId) {
      params.topicId = options.thesisTopicId;
    }
    if (options?.sectionId) {
      params.sectionId = options.sectionId;
    }
    router.push(pathFor(route, Object.keys(params).length > 0 ? params : undefined));
  }, [router]);

  // Lane entries are guarded here as well as by the (app) layout: a refused
  // lane goes to the role home (and its web hand-off), never to a half-built
  // route.
  const navigateLane = useCallback((id: LaneScreenId) => {
    if (session.kind === 'authenticated' && canAccessLaneScreen(session.role, session.capabilities ?? NO_CAPABILITIES, id)) {
      router.push(lanePathFor(id));
    } else {
      router.replace(roleHomePath(session.role));
    }
  }, [router, session]);

  const enterPreview = useCallback(() => {
    if (session.enterPreview()) {
      router.replace(roleHomePath(session.role));
    }
  }, [router, session]);

  const completeSignIn = useCallback((role: UserRole, accountId?: string | null) => {
    session.completeSignIn(role, accountId ?? session.accountId);
    router.replace(roleHomePath(role));
  }, [router, session]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(
        session.kind === 'signedOut' ? '/sign-in' : roleHomePath(session.role));
    }
  }, [router, session]);

  const signOut = useCallback(() => {
    // The store failure is already surfaced by the wipe having run; the user
    // still lands on sign-in instead of an unhandled rejection.
    void session.signOut().catch(() => undefined).finally(() => router.replace('/sign-in'));
  }, [router, session]);

  const switchRole = useCallback((role: UserRole) => {
    session.switchRole(role);
    router.replace(roleHomePath(role));
  }, [router, session]);

  return useMemo(() => ({
    navigate,
    navigateLane,
    enterPreview,
    completeSignIn,
    goBack,
    signOut,
    switchRole,
  }), [navigate, navigateLane, enterPreview, completeSignIn, goBack, signOut, switchRole]);
}
