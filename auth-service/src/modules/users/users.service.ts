import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { AuthShadowPublisher } from '../auth-shadow/auth-shadow.publisher';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private authShadowPublisher: AuthShadowPublisher,
  ) {}

  async create(createUserDto: CreateUserDto) {
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
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        address: true,
        status: true,
        createdAt: true,
      },
    });

    await this.authShadowPublisher.publishUserUpsertById(user.id);

    return user;
  }

  async findAll(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        where: status ? { status: status as any } : undefined,
        include: {
          roles: {
            include: {
              role: true,
            },
          },
          student: true,
          lecturer: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({
        where: status ? { status: status as any } : undefined,
      }),
    ]);

    return {
      data: users.map((user) => ({
        ...user,
        password: undefined,
        refreshToken: undefined,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        student: true,
        lecturer: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      password: undefined,
      refreshToken: undefined,
    };
  }

  async update(id: string, updateData: any) {
    await this.findOne(id);

    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 12);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        address: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.authShadowPublisher.publishUserUpsertById(user.id);

    return user;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    await this.authShadowPublisher.publishUserDeleted(id);
    return { message: 'User deleted successfully' };
  }

  async assignRole(userId: string, roleId: string) {
    await this.findOne(userId);

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const assignment = await this.prisma.userRole.upsert({
      where: {
        userId_roleId: { userId, roleId },
      },
      update: {},
      create: { userId, roleId },
    });

    await this.authShadowPublisher.publishUserRolesSynced(userId);

    return assignment;
  }

  async removeRole(userId: string, roleId: string) {
    await this.prisma.userRole.deleteMany({
      where: { userId, roleId },
    });
    await this.authShadowPublisher.publishUserRolesSynced(userId);
    return { message: 'Role removed successfully' };
  }
}
