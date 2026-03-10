import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

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

  async create(data: { name: string; description?: string; module: string; action: string }) {
    return this.prisma.permission.create({
      data,
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.prisma.permission.delete({ where: { id } });
    return { message: 'Permission deleted successfully' };
  }
}
