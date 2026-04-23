import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailService } from '../common/services/email.service';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';
import { AuthUser } from './types/auth-user.type';
import { parseDurationToMs } from './auth-session.util';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { AuthShadowPublisher } from '../auth-shadow/auth-shadow.publisher';

type AuthUserRecord = {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  gender: string | null;
  dateOfBirth: Date | null;
  address: string | null;
  avatar: string | null;
  status: UserStatus;
  createdAt: Date;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  refreshToken: string | null;
  resetToken: string | null;
  resetExpires: Date | null;
  verificationToken: string | null;
  roles: Array<{
    role: {
      name: string;
      permissions: Array<{
        permission: {
          module: string;
          action: string;
        };
      }>;
    };
  }>;
  student: { id: string; year?: number | null } | null;
  lecturer: { id: string } | null;
};

const AUDIT_LOG_EVENTS_QUEUE = 'audit-log-events' as const;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private configService: ConfigService,
    private rabbitMQService: RabbitMQService,
    private authShadowPublisher: AuthShadowPublisher,
  ) {}

  async register(createUserDto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        dateOfBirth: createUserDto.dateOfBirth
          ? new Date(createUserDto.dateOfBirth)
          : undefined,
        password: hashedPassword,
      },
      include: this.authInclude(),
    });

    const authenticatedUser = this.sanitizeUser(
      user as unknown as AuthUserRecord,
    );
    await this.authShadowPublisher.publishUserUpsertById(authenticatedUser.id);
    const tokens = await this.issueTokens(authenticatedUser);

    return {
      user: authenticatedUser,
      ...tokens,
    };
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string) {
    const authenticatedUser = await this.validateLocalCredentials(
      loginDto.email,
      loginDto.password,
    );

    const tokens = await this.issueTokens(
      authenticatedUser,
      ipAddress,
      userAgent,
    );
    await this.authShadowPublisher.publishUserUpsertById(authenticatedUser.id);

    await this.createAuditLog(
      authenticatedUser.id,
      'LOGIN',
      'User',
      authenticatedUser.id,
      null,
      { email: authenticatedUser.email },
      ipAddress,
      userAgent,
    );

    return {
      user: authenticatedUser,
      ...tokens,
    };
  }

  async logout(userId: string, refreshToken?: string | null) {
    if (refreshToken) {
      await this.prisma.session.deleteMany({
        where: {
          userId,
          refreshToken: this.hashToken(refreshToken),
        },
      });
    } else {
      await this.prisma.session.deleteMany({
        where: { userId },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    await this.authShadowPublisher.publishUserUpsertById(userId);

    await this.createAuditLog(userId, 'LOGOUT', 'User', userId, null, null);
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    if (!refreshTokenDto.refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    const hashedRefreshToken = this.hashToken(refreshTokenDto.refreshToken);

    const session = await this.prisma.session.findFirst({
      where: {
        refreshToken: hashedRefreshToken,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: {
          include: this.authInclude(),
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const authenticatedUser = this.sanitizeUser(
      session.user as unknown as AuthUserRecord,
    );
    const tokens = await this.generateTokens(authenticatedUser);
    await this.storeRefreshSession(authenticatedUser.id, tokens.refreshToken);
    await this.authShadowPublisher.publishUserUpsertById(authenticatedUser.id);

    return {
      user: authenticatedUser,
      ...tokens,
    };
  }

  async validateLocalCredentials(
    email: string,
    password: string,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: this.authInclude(),
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account is locked. Please try again later.',
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      const nextAttemptCount = user.failedLoginAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttemptCount,
          lockedUntil:
            nextAttemptCount >= 5
              ? new Date(Date.now() + 30 * 60 * 1000)
              : null,
        },
      });
      await this.authShadowPublisher.publishUserUpsertById(user.id);

      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
    await this.authShadowPublisher.publishUserUpsertById(user.id);

    return this.sanitizeUser(user as unknown as AuthUserRecord);
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: this.authInclude(),
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      return null;
    }

    return this.sanitizeUser(user as unknown as AuthUserRecord);
  }

  async updateProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      dateOfBirth?: string;
      address?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName ?? user.firstName,
        lastName: data.lastName ?? user.lastName,
        phone: data.phone ?? user.phone,
        dateOfBirth: data.dateOfBirth
          ? new Date(data.dateOfBirth)
          : user.dateOfBirth,
        address: data.address ?? user.address,
      },
      include: this.authInclude(),
    });
    await this.authShadowPublisher.publishUserUpsertById(userId);

    return this.sanitizeUser(updatedUser as unknown as AuthUserRecord);
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('Invalid old password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        passwordChangedAt: new Date(),
        refreshToken: null,
      },
    });

    await this.prisma.session.deleteMany({
      where: { userId },
    });
    await this.authShadowPublisher.publishUserUpsertById(userId);

    await this.createAuditLog(
      userId,
      'PASSWORD_CHANGE',
      'User',
      userId,
      null,
      null,
    );

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return { message: 'If the email exists, a reset link will be sent' };
    }

    const resetToken = randomUUID();
    const resetExpires = new Date(
      Date.now() + this.getPasswordResetExpiryMinutes() * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetExpires,
      },
    });

    const resetUrl = `${this.getFrontendUrl()}/reset-password?token=${resetToken}`;
    await this.emailService.sendPasswordResetEmail(
      user.email,
      user.firstName || 'User',
      resetUrl,
    );

    return { message: 'If the email exists, a reset link will be sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: token,
        resetExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetExpires: null,
        passwordChangedAt: new Date(),
        refreshToken: null,
      },
    });
    await this.authShadowPublisher.publishUserUpsertById(user.id);

    await this.prisma.session.deleteMany({
      where: { userId: user.id },
    });

    await this.createAuditLog(
      user.id,
      'PASSWORD_RESET',
      'User',
      user.id,
      null,
      null,
    );

    return { message: 'Password reset successfully' };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        verificationToken: token,
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null,
        status: UserStatus.ACTIVE,
      },
    });
    await this.authShadowPublisher.publishUserUpsertById(user.id);

    await this.createAuditLog(
      user.id,
      'EMAIL_VERIFIED',
      'User',
      user.id,
      null,
      null,
    );

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return {
        message:
          'If the email is not verified, a verification link will be sent',
      };
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const verificationToken = randomUUID();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { verificationToken },
    });
    await this.authShadowPublisher.publishUserUpsertById(user.id);

    const verifyUrl = `${this.getFrontendUrl()}/verify-email?token=${verificationToken}`;
    await this.emailService.sendVerificationEmail(
      user.email,
      user.firstName,
      verifyUrl,
    );

    return { message: 'Verification email sent' };
  }

  private async issueTokens(
    user: AuthUser,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const tokens = await this.generateTokens(user);
    await this.storeRefreshSession(
      user.id,
      tokens.refreshToken,
      ipAddress,
      userAgent,
    );
    return tokens;
  }

  private async generateTokens(user: AuthUser) {
    const payload = {
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      address: user.address,
      avatar: user.avatar,
      status: user.status,
      createdAt: user.createdAt,
      roles: user.roles,
      permissions: user.permissions,
      studentId: user.studentId || null,
      lecturerId: user.lecturerId || null,
      student: user.student ?? null,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.getOrThrow<string>(
          ENV.JWT_EXPIRES_IN,
        ) as StringValue,
      }),
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.getOrThrow<string>(
          ENV.JWT_REFRESH_EXPIRES_IN,
        ) as StringValue,
        secret: this.configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshSession(
    userId: string,
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const hashedRefreshToken = this.hashToken(refreshToken);

    await this.prisma.session.deleteMany({
      where: { userId },
    });

    await this.prisma.session.create({
      data: {
        userId,
        refreshToken: hashedRefreshToken,
        ipAddress,
        userAgent,
        expiresAt: new Date(
          Date.now() + parseDurationToMs(this.getRefreshTokenExpiry()),
        ),
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedRefreshToken },
    });
  }

  private sanitizeUser(user: AuthUserRecord): AuthUser {
    const roles = user.roles?.map((relation) => relation.role.name) ?? [];
    const permissions =
      user.roles?.flatMap((relation) =>
        relation.role.permissions.map(
          (permission) =>
            `${permission.permission.module}:${permission.permission.action}`,
        ),
      ) ?? [];

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      address: user.address,
      avatar: user.avatar,
      status: user.status,
      createdAt: user.createdAt,
      roles,
      permissions,
      studentId: user.student?.id || null,
      lecturerId: user.lecturer?.id || null,
      student: user.student
        ? {
            year: user.student.year ?? null,
          }
        : null,
    };
  }

  private authInclude() {
    return {
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
      student: true,
      lecturer: true,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getFrontendUrl() {
    return (
      this.configService.get<string>(ENV.FRONTEND_URL) ??
      ENV_DEFAULTS.FRONTEND_URL
    );
  }

  private getRefreshTokenExpiry() {
    return this.configService.get<string>(
      ENV.JWT_REFRESH_EXPIRES_IN,
      ENV_DEFAULTS.JWT_REFRESH_EXPIRES_IN,
    );
  }

  private getPasswordResetExpiryMinutes() {
    return this.configService.get<number>(
      ENV.PASSWORD_RESET_EXPIRY_MINUTES,
      ENV_DEFAULTS.PASSWORD_RESET_EXPIRY_MINUTES,
    );
  }

  private async createAuditLog(
    userId: string,
    action: string,
    entity: string,
    entityId?: string,
    oldValues?: unknown,
    newValues?: unknown,
    ipAddress?: string,
    userAgent?: string,
    description?: string,
  ) {
    await this.rabbitMQService.publishMessage(AUDIT_LOG_EVENTS_QUEUE, {
      type: 'audit-log.created',
      source: 'campuscore-auth-service',
      occurredAt: new Date().toISOString(),
      payload: {
        userId,
        action,
        entity,
        entityId,
        oldValues: oldValues ?? null,
        newValues: newValues ?? null,
        ipAddress,
        userAgent,
        description,
      },
    });
  }
}
