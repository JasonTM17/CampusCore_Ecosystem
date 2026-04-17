import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    changePassword: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerificationEmail: jest.fn(),
    validateUser: jest.fn(),
    updateProfile: jest.fn(),
  };

  const controller = new AuthController(authService as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyEmail', () => {
    it('should prefer the query token over the legacy body token', async () => {
      authService.verifyEmail.mockResolvedValue({ message: 'ok' });

      await controller.verifyEmail(
        { token: 'query-token' },
        { token: 'body-token' },
      );

      expect(authService.verifyEmail).toHaveBeenCalledWith('query-token');
    });

    it('should fall back to the legacy body token', async () => {
      authService.verifyEmail.mockResolvedValue({ message: 'ok' });

      await controller.verifyEmail({}, { token: 'body-token' });

      expect(authService.verifyEmail).toHaveBeenCalledWith('body-token');
    });

    it('should reject missing verification tokens', async () => {
      await expect(controller.verifyEmail({}, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke the provided refresh token when present', async () => {
      authService.logout.mockResolvedValue(undefined);

      await controller.logout(
        { user: { sub: 'user-uuid' } },
        { refreshToken: 'refresh-token' },
      );

      expect(authService.logout).toHaveBeenCalledWith(
        'user-uuid',
        'refresh-token',
      );
    });

    it('should fall back to a session-wide logout when no refresh token is present', async () => {
      authService.logout.mockResolvedValue(undefined);

      await controller.logout({ user: { sub: 'user-uuid' } }, {});

      expect(authService.logout).toHaveBeenCalledWith('user-uuid', undefined);
    });
  });
});
