import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EmailService } from '../common/services/email.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { AuthShadowPublisher } from '../auth-shadow/auth-shadow.publisher';

describe('AuthService', () => {
  let service: AuthService;

  const hashedPassword = bcrypt.hashSync('password123', 12);

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    session: {
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn(),
  };

  const mockEmailService = {
    sendEmail: jest.fn(),
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        FRONTEND_URL: 'http://localhost',
        JWT_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return values[key] ?? defaultValue;
    }),
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
      };
      return values[key];
    }),
  };

  const mockRabbitMQService = {
    publishMessage: jest.fn().mockResolvedValue(true),
  };

  const mockAuthShadowPublisher = {
    publishUserUpsertById: jest.fn().mockResolvedValue(undefined),
  };

  const buildUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'user-uuid-123',
    email: 'student1@campuscore.edu',
    password: hashedPassword,
    firstName: 'Test',
    lastName: 'Student',
    phone: null,
    gender: null,
    dateOfBirth: null,
    address: null,
    avatar: null,
    status: 'ACTIVE',
    emailVerified: true,
    isSuperAdmin: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    passwordChangedAt: null,
    refreshToken: null,
    resetToken: null,
    resetExpires: null,
    verificationToken: null,
    roles: [],
    student: null,
    lecturer: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
        {
          provide: AuthShadowPublisher,
          useValue: mockAuthShadowPublisher,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
    jest.spyOn(bcrypt, 'compare').mockImplementation(async (value) => {
      return value === 'password123';
    });
    mockJwtService.signAsync.mockReset();
    mockRabbitMQService.publishMessage.mockClear();
    mockAuthShadowPublisher.publishUserUpsertById.mockClear();
  });

  describe('login', () => {
    const loginDto = {
      email: 'student1@campuscore.edu',
      password: 'password123',
    };

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      const mockUser = buildUser();
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.login({ ...loginDto, password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should issue and persist refresh tokens for valid credentials', async () => {
      const mockUser = buildUser();
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await service.login(loginDto, '127.0.0.1', 'jest');

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(mockPrisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: mockUser.id,
            refreshToken: createHash('sha256')
              .update('refresh-token')
              .digest('hex'),
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
          }),
        }),
      );
    });
  });

  describe('logout', () => {
    it('should revoke the matching refresh session when a token is provided', async () => {
      mockPrisma.user.update.mockResolvedValue(buildUser());

      await service.logout('user-uuid', 'refresh-token');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid',
          refreshToken: createHash('sha256')
            .update('refresh-token')
            .digest('hex'),
        },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { refreshToken: null },
      });
    });

    it('should revoke every session for the user when no refresh token is provided', async () => {
      mockPrisma.user.update.mockResolvedValue(buildUser());

      await service.logout('user-uuid');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
      });
    });
  });

  describe('refreshToken', () => {
    it('should rotate the refresh token and persist a hashed session', async () => {
      mockPrisma.session.findFirst.mockResolvedValue({
        refreshToken: createHash('sha256')
          .update('refresh-token')
          .digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        user: buildUser(),
      });
      mockJwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');

      const result = await service.refreshToken({
        refreshToken: 'refresh-token',
      });

      expect(result.accessToken).toBe('new-access-token');
      expect(mockPrisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refreshToken: createHash('sha256')
              .update('new-refresh-token')
              .digest('hex'),
          }),
        }),
      );
    });

    it('should reject an invalid refresh token', async () => {
      mockPrisma.session.findFirst.mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyEmail', () => {
    it('should reject an unknown verification token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.verifyEmail('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
