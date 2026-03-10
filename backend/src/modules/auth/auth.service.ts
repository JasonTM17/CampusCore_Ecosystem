import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(createUserDto: CreateUserDto) {
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
        password: hashedPassword,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    const tokens = await this.generateTokens(user);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is locked. Please try again later.');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);

    if (!isPasswordValid) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: user.failedLoginAttempts + 1,
          lockedUntil: user.failedLoginAttempts >= 4 ? new Date(Date.now() + 30 * 60 * 1000) : null,
        },
      });
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

    const tokens = await this.generateTokens(user);
    await this.updateRefreshToken(user.id, tokens.refreshToken, ipAddress, userAgent);

    await this.createAuditLog(user.id, 'LOGIN', 'User', user.id, null, { email: user.email }, ipAddress, userAgent);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.session.deleteMany({
        where: { refreshToken },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    await this.createAuditLog(userId, 'LOGOUT', 'User', userId, null, null);
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    const session = await this.prisma.session.findFirst({
      where: { refreshToken },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = session.user;
    const tokens = await this.generateTokens(user);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
        student: true,
        lecturer: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      return null;
    }

    return this.sanitizeUser(user);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
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

    await this.createAuditLog(userId, 'PASSWORD_CHANGE', 'User', userId, null, null);

    return { message: 'Password changed successfully' };
  }

  private async generateTokens(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles.map((r: any) => r.role.name),
      permissions: user.roles.flatMap((r: any) => 
        r.role.permissions.map((p: any) => `${p.module}:${p.action}`)
      ),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d', secret: process.env.JWT_REFRESH_SECRET || 'refresh-secret' }),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string, ipAddress?: string, userAgent?: string) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        refreshToken,
        ipAddress,
        userAgent,
        expiresAt,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken },
    });
  }

  private sanitizeUser(user: any) {
    const { password, refreshToken, failedLoginAttempts, lockedUntil, ...sanitized } = user;
    return {
      ...sanitized,
      roles: user.roles.map((r: any) => r.role.name),
      permissions: user.roles.flatMap((r: any) =>
        r.role.permissions.map((p: any) => `${p.module}:${p.action}`)
      ),
    };
  }

  private async createAuditLog(
    userId: string,
    action: string,
    entity: string,
    entityId?: string,
    oldValues?: any,
    newValues?: any,
    ipAddress?: string,
    userAgent?: string,
    description?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        oldValues,
        newValues,
        ipAddress,
        userAgent,
        description,
      },
    });
  }
}
