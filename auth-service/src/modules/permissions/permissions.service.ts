import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthShadowPublisher } from '../auth-shadow/auth-shadow.publisher';

@Injectable()
export class PermissionsService {
  constructor(
    private prisma: PrismaService,
    private authShadowPublisher: AuthShadowPublisher,
  ) {}

  async findAll() {
    return this.prisma.permission.findMany({
      orderBy: { module: 'asc' },
    });
  }

  async findOne(id: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { id },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    return permission;
  }

  async create(data: {
    name: string;
    description?: string;
    module: string;
    action: string;
  }) {
    const permission = await this.prisma.permission.create({
      data,
    });

    await this.authShadowPublisher.publishPermissionUpsertById(permission.id);

    return permission;
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.prisma.permission.delete({ where: { id } });
    await this.authShadowPublisher.publishPermissionDeleted(id);
    return { message: 'Permission deleted successfully' };
  }
}
