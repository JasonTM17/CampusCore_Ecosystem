import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RoleName } from '@prisma/client';
import { AuthShadowPublisher } from '../auth-shadow/auth-shadow.publisher';

@Injectable()
export class RolesService {
  constructor(
    private prisma: PrismaService,
    private authShadowPublisher: AuthShadowPublisher,
  ) {}

  async findAll() {
    return this.prisma.role.findMany({
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        users: true,
      },
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        users: true,
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  async create(data: { name: RoleName; description?: string }) {
    const role = await this.prisma.role.create({
      data,
      include: {
        permissions: true,
      },
    });

    await this.authShadowPublisher.publishRoleUpsertById(role.id);

    return role;
  }

  async update(id: string, data: { name?: RoleName; description?: string }) {
    await this.findOne(id);
    const role = await this.prisma.role.update({
      where: { id },
      data,
      include: {
        permissions: true,
      },
    });

    await this.authShadowPublisher.publishRoleUpsertById(role.id);

    return role;
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.prisma.role.delete({ where: { id } });
    await this.authShadowPublisher.publishRoleDeleted(id);
    return { message: 'Role deleted successfully' };
  }

  async assignPermission(roleId: string, permissionId: string) {
    const assignment = await this.prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId, permissionId },
      },
      update: {},
      create: { roleId, permissionId },
    });

    await this.authShadowPublisher.publishRolePermissionsSynced(roleId);

    return assignment;
  }

  async removePermission(roleId: string, permissionId: string) {
    await this.prisma.rolePermission.deleteMany({
      where: { roleId, permissionId },
    });
    await this.authShadowPublisher.publishRolePermissionsSynced(roleId);
    return { message: 'Permission removed from role' };
  }
}
