import { apiClient, createApiClient, type ApiClient } from '../../api/client';

/**
 * Account endpoints, called through the existing client. Recovery requests
 * run on a separate anonymous client: no Bearer header and no refresh lane,
 * so a recovery call can never touch (or be blamed on) a signed-in session.
 * Secrets pass through as arguments only; nothing here stores or logs them.
 */

export interface MessageResponse {
  message: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
}

export interface TwoFactorChallenge {
  challengeId: string;
}

let anonymousClient: ApiClient | null = null;

// Built lazily so importing this module never needs the live client.
function anonymous(): ApiClient {
  anonymousClient ??= createApiClient({ baseUrl: apiClient.baseUrl, mode: apiClient.mode });
  return anonymousClient;
}

export const accountApi = {
  forgotPassword: (email: string) =>
    anonymous().post<MessageResponse>('/auth/forgot-password', { email }),

  resetPassword: (token: string, newPassword: string) =>
    anonymous().post<MessageResponse>('/auth/reset-password', { token, newPassword }),

  twoFactorStatus: () => apiClient.get<TwoFactorStatus>('/me/two-factor'),

  beginTwoFactorEnable: (password: string) =>
    apiClient.post<TwoFactorChallenge>('/me/two-factor/enable', { password }),

  confirmTwoFactorEnable: (challengeId: string, code: string) =>
    apiClient.post<TwoFactorStatus>('/me/two-factor/confirm', { challengeId, code }),

  beginTwoFactorDisable: (password: string) =>
    apiClient.post<TwoFactorChallenge>('/me/two-factor/disable/challenge', { password }),

  confirmTwoFactorDisable: (challengeId: string, code: string) =>
    apiClient.post<TwoFactorStatus>('/me/two-factor/disable', { challengeId, code }),
};
