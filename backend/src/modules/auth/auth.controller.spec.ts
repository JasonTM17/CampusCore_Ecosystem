import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { Response } from 'express';

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
  const configService = {
    get: jest.fn(),
  };
  const createResponse = () =>
    ({
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    }) as unknown as Response;

  const controller = new AuthController(
    authService as never,
    configService as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((_key: string, fallback?: unknown) => {
      return fallback;
    });
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
      const response = createResponse();

      await controller.logout(
        { user: { sub: 'user-uuid' } } as never,
        { refreshToken: 'refresh-token' },
        response,
      );

      expect(authService.logout).toHaveBeenCalledWith(
        'user-uuid',
        'refresh-token',
      );
      expect(response.clearCookie).toHaveBeenCalledTimes(3);
    });

    it('should fall back to a session-wide logout when no refresh token is present', async () => {
      authService.logout.mockResolvedValue(undefined);
      const response = createResponse();

      await controller.logout(
        { user: { sub: 'user-uuid' } } as never,
        {},
        response,
      );

      expect(authService.logout).toHaveBeenCalledWith('user-uuid', null);
      expect(response.clearCookie).toHaveBeenCalledTimes(3);
    });
  });

  describe('refresh', () => {
    it('should use the cookie/body fallback refresh token and issue cookies', async () => {
      authService.refreshToken.mockResolvedValue({
        accessToken: 'next-access',
        refreshToken: 'next-refresh',
        user: { id: 'user-uuid' },
      });
      const response = createResponse();

      await controller.refresh(
        {} as never,
        {
          cookies: { cc_refresh_token: 'cookie-refresh' },
        } as never,
        response,
      );

      expect(authService.refreshToken).toHaveBeenCalledWith({
        refreshToken: 'cookie-refresh',
      });
      expect(response.cookie).toHaveBeenCalledTimes(3);
    });

    it('should reject missing refresh tokens', async () => {
      await expect(
        controller.refresh(
          {} as never,
          { cookies: {} } as never,
          createResponse(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
