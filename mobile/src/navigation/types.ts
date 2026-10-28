import type { LaneScreenId, ScreenName, UserRole } from './routes';

export interface MobileNavigationOptions {
  thesisTopicId?: string;
  sectionId?: string;
}

export interface MobileNavigation {
  navigate(route: ScreenName, options?: MobileNavigationOptions): void;
  /** Flag-gated lane entry; refused lanes fall back to the role home. */
  navigateLane?(id: LaneScreenId): void;
  enterPreview(): void;
  completeSignIn(role: UserRole, accountId?: string | null): void;
  goBack(): void;
  signOut(): void;
  switchRole(role: UserRole): void;
}

export interface MobileScreenProps {
  navigation: MobileNavigation;
  role: UserRole;
  selectedThesisTopicId: string | null;
}
