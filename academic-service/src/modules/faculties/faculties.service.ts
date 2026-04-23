import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  hydrateLocalizedCatalogRecord,
  normalizeLocalizedCatalogData,
} from '../common/catalog-localization';

@Injectable()
export class FacultiesService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const faculty = await this.prisma.faculty.create({
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('faculty', data),
      },
      include: { departments: true },
    });

    return this.hydrateFaculty(faculty);
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [faculties, total] = await Promise.all([
      this.prisma.faculty.findMany({
        skip,
        take: limit,
        include: { departments: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.faculty.count(),
    ]);
    return {
      data: faculties.map((faculty) => this.hydrateFaculty(faculty)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      include: { departments: true },
    });
    if (!faculty) throw new NotFoundException('Faculty not found');
    return this.hydrateFaculty(faculty);
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.faculty.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty not found');
    }

    const faculty = await this.prisma.faculty.update({
      where: { id },
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('faculty', data, existing),
      },
      include: { departments: true },
    });

    return this.hydrateFaculty(faculty);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.faculty.delete({ where: { id } });
    return { message: 'Faculty deleted successfully' };
  }

  private hydrateFaculty<T extends { departments?: any[] }>(faculty: T) {
    return {
      ...hydrateLocalizedCatalogRecord('faculty', faculty as any),
      departments: faculty.departments?.map((department) =>
        hydrateLocalizedCatalogRecord('department', department),
      ),
    };
  }
}
