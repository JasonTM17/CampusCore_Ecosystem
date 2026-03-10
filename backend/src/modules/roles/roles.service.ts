import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RoleName } from '@prisma/client';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.role.create({
      data,
      include: {
        permissions: true,
      },
    });
  }

  async update(id: string, data: { name?: RoleName; description?: string }) {
    await this.findOne(id);
    return this.prisma.role.update({
      where: { id },
      data,
      include: {
        permissions: true,
      },
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.prisma.role.delete({ where: { id } });
    return { message: 'Role deleted successfully' };
  }

  async assignPermission(roleId: string, permissionId: string) {
    return this.prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId, permissionId },
      },
      update: {},
      create: { roleId, permissionId },
    });
  }

  async removePermission(roleId: string, permissionId: string) {
    await this.prisma.rolePermission.deleteMany({
      where: { roleId, permissionId },
    });
    return { message: 'Permission removed from role' };
  }
}
