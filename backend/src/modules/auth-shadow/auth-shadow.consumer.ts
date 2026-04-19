import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Gender, RoleName, UserStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

const AUTH_SHADOW_QUEUE = 'auth-shadow' as const;

type UserUpsertPayload = {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  address?: string | null;
  avatar?: string | null;
  status: UserStatus;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  failedLoginAttempts: number;
  lockedUntil?: string | null;
  lastLoginAt?: string | null;
  passwordChangedAt?: string | null;
  refreshToken?: string | null;
  resetToken?: string | null;
  resetExpires?: string | null;
  verificationToken?: string | null;
  createdAt: string;
  updatedAt: string;
};

type RoleUpsertPayload = {
  id: string;
  name: RoleName;
  description?: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

type PermissionUpsertPayload = {
  id: string;
  name: string;
  description?: string | null;
  module: string;
  action: string;
  createdAt: string;
};

type UserRolesSyncedPayload = {
  userId: string;
  assignments: Array<{
    id: string;
    userId: string;
    roleId: string;
  }>;
};

type RolePermissionsSyncedPayload = {
  roleId: string;
  assignments: Array<{
    id: string;
    roleId: string;
    permissionId: string;
  }>;
};

type AuthShadowEvent = {
  type: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class AuthShadowConsumer implements OnModuleInit {
  private readonly logger = new Logger(AuthShadowConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQService.consumeMessages(
      AUTH_SHADOW_QUEUE,
      async (message) => {
        await this.handleEvent(message as AuthShadowEvent);
      },
    );
  }

  private async handleEvent(event: AuthShadowEvent) {
    switch (event.type) {
      case 'user.upserted':
        await this.syncUser(event.payload as UserUpsertPayload);
        return;
      case 'user.deleted':
        await this.prisma.user.deleteMany({
          where: { id: String(event.payload.id) },
        });
        return;
      case 'role.upserted':
        await this.syncRole(event.payload as RoleUpsertPayload);
        return;
      case 'role.deleted':
        await this.prisma.role.deleteMany({
          where: { id: String(event.payload.id) },
        });
        return;
      case 'permission.upserted':
        await this.syncPermission(event.payload as PermissionUpsertPayload);
        return;
      case 'permission.deleted':
        await this.prisma.permission.deleteMany({
          where: { id: String(event.payload.id) },
        });
        return;
      case 'user-roles.synced':
        await this.syncUserRoles(event.payload as UserRolesSyncedPayload);
        return;
      case 'role-permissions.synced':
        await this.syncRolePermissions(
          event.payload as RolePermissionsSyncedPayload,
        );
        return;
      default:
        this.logger.warn(
          `Ignoring unsupported auth shadow event: ${event.type}`,
        );
    }
  }

  private async syncUser(payload: UserUpsertPayload) {
    await this.prisma.user.upsert({
      where: { id: payload.id },
      update: {
        email: payload.email,
        password: payload.password,
        firstName: payload.firstName,
        lastName: payload.lastName,
        phone: payload.phone ?? null,
        gender: payload.gender ?? null,
        dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
        address: payload.address ?? null,
        avatar: payload.avatar ?? null,
        status: payload.status,
        emailVerified: payload.emailVerified,
        isSuperAdmin: payload.isSuperAdmin,
        failedLoginAttempts: payload.failedLoginAttempts,
        lockedUntil: payload.lockedUntil ? new Date(payload.lockedUntil) : null,
        lastLoginAt: payload.lastLoginAt ? new Date(payload.lastLoginAt) : null,
        passwordChangedAt: payload.passwordChangedAt
          ? new Date(payload.passwordChangedAt)
          : null,
        refreshToken: payload.refreshToken ?? null,
        resetToken: payload.resetToken ?? null,
        resetExpires: payload.resetExpires
          ? new Date(payload.resetExpires)
          : null,
        verificationToken: payload.verificationToken ?? null,
        createdAt: new Date(payload.createdAt),
        updatedAt: new Date(payload.updatedAt),
      },
      create: {
        id: payload.id,
        email: payload.email,
        password: payload.password,
        firstName: payload.firstName,
        lastName: payload.lastName,
        phone: payload.phone ?? null,
        gender: payload.gender ?? null,
        dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
        address: payload.address ?? null,
        avatar: payload.avatar ?? null,
        status: payload.status,
        emailVerified: payload.emailVerified,
        isSuperAdmin: payload.isSuperAdmin,
        failedLoginAttempts: payload.failedLoginAttempts,
        lockedUntil: payload.lockedUntil ? new Date(payload.lockedUntil) : null,
        lastLoginAt: payload.lastLoginAt ? new Date(payload.lastLoginAt) : null,
        passwordChangedAt: payload.passwordChangedAt
          ? new Date(payload.passwordChangedAt)
          : null,
        refreshToken: payload.refreshToken ?? null,
        resetToken: payload.resetToken ?? null,
        resetExpires: payload.resetExpires
          ? new Date(payload.resetExpires)
          : null,
        verificationToken: payload.verificationToken ?? null,
        createdAt: new Date(payload.createdAt),
        updatedAt: new Date(payload.updatedAt),
      },
    });
  }

  private async syncRole(payload: RoleUpsertPayload) {
    await this.prisma.role.upsert({
      where: { id: payload.id },
      update: {
        name: payload.name,
        description: payload.description ?? null,
        isSystem: payload.isSystem,
        createdAt: new Date(payload.createdAt),
        updatedAt: new Date(payload.updatedAt),
      },
      create: {
        id: payload.id,
        name: payload.name,
        description: payload.description ?? null,
        isSystem: payload.isSystem,
        createdAt: new Date(payload.createdAt),
        updatedAt: new Date(payload.updatedAt),
      },
    });
  }

  private async syncPermission(payload: PermissionUpsertPayload) {
    await this.prisma.permission.upsert({
      where: { id: payload.id },
      update: {
        name: payload.name,
        description: payload.description ?? null,
        module: payload.module,
        action: payload.action,
        createdAt: new Date(payload.createdAt),
      },
      create: {
        id: payload.id,
        name: payload.name,
        description: payload.description ?? null,
        module: payload.module,
        action: payload.action,
        createdAt: new Date(payload.createdAt),
      },
    });
  }

  private async syncUserRoles(payload: UserRolesSyncedPayload) {
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId: payload.userId },
      });

      if (payload.assignments.length > 0) {
        await tx.userRole.createMany({
          data: payload.assignments,
          skipDuplicates: true,
        });
      }
    });
  }

  private async syncRolePermissions(payload: RolePermissionsSyncedPayload) {
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: { roleId: payload.roleId },
      });

      if (payload.assignments.length > 0) {
        await tx.rolePermission.createMany({
          data: payload.assignments,
          skipDuplicates: true,
        });
      }
    });
  }
}
