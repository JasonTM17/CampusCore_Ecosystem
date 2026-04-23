import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  hydrateLocalizedCatalogRecord,
  normalizeLocalizedCatalogData,
} from '../common/catalog-localization';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const department = await this.prisma.department.create({
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('department', data),
      },
      include: { faculty: true, lecturers: true },
    });

    return this.hydrateDepartment(department);
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [departments, total] = await Promise.all([
      this.prisma.department.findMany({
        skip,
        take: limit,
        include: { faculty: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.count(),
    ]);
    return {
      data: departments.map((department) => this.hydrateDepartment(department)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: { faculty: true, lecturers: true },
    });
    if (!department) throw new NotFoundException('Department not found');
    return this.hydrateDepartment(department);
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.department.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Department not found');
    }

    const department = await this.prisma.department.update({
      where: { id },
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('department', data, existing),
      },
      include: { faculty: true },
    });

    return this.hydrateDepartment(department);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.department.delete({ where: { id } });
    return { message: 'Department deleted successfully' };
  }

  private hydrateDepartment<T extends { faculty?: any }>(department: T) {
    return {
      ...hydrateLocalizedCatalogRecord('department', department as any),
      faculty: department.faculty
        ? hydrateLocalizedCatalogRecord('faculty', department.faculty)
        : department.faculty,
    };
  }
}
