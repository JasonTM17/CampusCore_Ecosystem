import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: jest.Mocked<PrismaService>;

  const hashedPassword = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G0r.Y6ByhJQGXm'; // password123

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    session: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn(),
  };

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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get(PrismaService);

    jest.clearAllMocks();
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
      const mockUser = {
        id: 'user-uuid-123',
        email: 'student1@campuscore.edu',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Student',
        status: 'ACTIVE',
        roles: [],
        student: null,
        lecturer: null,
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.login({ ...loginDto, password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      const mockUser = {
        id: 'user-uuid-123',
        email: 'student1@campuscore.edu',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Student',
        status: 'INACTIVE',
        roles: [],
        student: null,
        lecturer: null,
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should clear user refresh token on logout', async () => {
      mockPrisma.user.update.mockResolvedValue({ id: 'user-uuid' });

      await service.logout('user-uuid');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { refreshToken: null },
      });
    });
  });
});
