import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

const AUTH_SHADOW_QUEUE = 'auth-shadow' as const;
const AUTH_SHADOW_SOURCE = 'campuscore-auth-service' as const;

@Injectable()
export class AuthShadowPublisher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async publishUserUpsertById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return;
    }

    await this.publish('user.upserted', {
      id: user.id,
      email: user.email,
      password: user.password,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth?.toISOString() ?? null,
      address: user.address,
      avatar: user.avatar,
      status: user.status,
      emailVerified: user.emailVerified,
      isSuperAdmin: user.isSuperAdmin,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      refreshToken: user.refreshToken,
      resetToken: user.resetToken,
      resetExpires: user.resetExpires?.toISOString() ?? null,
      verificationToken: user.verificationToken,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    });
  }

  async publishUserDeleted(userId: string) {
    await this.publish('user.deleted', { id: userId });
  }

  async publishRoleUpsertById(roleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      return;
    }

    await this.publish('role.upserted', {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    });
  }

  async publishRoleDeleted(roleId: string) {
    await this.publish('role.deleted', { id: roleId });
  }

  async publishPermissionUpsertById(permissionId: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { id: permissionId },
    });

    if (!permission) {
      return;
    }

    await this.publish('permission.upserted', {
      id: permission.id,
      name: permission.name,
      description: permission.description,
      module: permission.module,
      action: permission.action,
      createdAt: permission.createdAt.toISOString(),
    });
  }

  async publishPermissionDeleted(permissionId: string) {
    await this.publish('permission.deleted', { id: permissionId });
  }

  async publishUserRolesSynced(userId: string) {
    const assignments = await this.prisma.userRole.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        roleId: true,
      },
    });

    await this.publish('user-roles.synced', {
      userId,
      assignments,
    });
  }

  async publishRolePermissionsSynced(roleId: string) {
    const assignments = await this.prisma.rolePermission.findMany({
      where: { roleId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        roleId: true,
        permissionId: true,
      },
    });

    await this.publish('role-permissions.synced', {
      roleId,
      assignments,
    });
  }

  private async publish(type: string, payload: Record<string, unknown>) {
    await this.rabbitMQService.publishMessage(AUTH_SHADOW_QUEUE, {
      type,
      source: AUTH_SHADOW_SOURCE,
      occurredAt: new Date().toISOString(),
      payload,
    });
  }
}
