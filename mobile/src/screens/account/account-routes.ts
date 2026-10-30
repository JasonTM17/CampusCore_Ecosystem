import type { ScreenName } from '../../navigation/routes';

/**
 * Route names the shell registers for the signed-out account screens. They
 * are listed here so the screens navigate by name.
 */
export const ACCOUNT_SCREENS = {
  forgotPassword: 'auth.forgotPassword',
  resetPassword: 'auth.resetPassword',
  loggedOut: 'auth.loggedOut',
} as const;

export type AccountScreenKey = keyof typeof ACCOUNT_SCREENS;

export function accountScreen(key: AccountScreenKey): ScreenName {
  return ACCOUNT_SCREENS[key];
}
