import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  hydrateLocalizedCatalogRecord,
  normalizeLocalizedCatalogData,
} from '../common/catalog-localization';

@Injectable()
export class CurriculaService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const curriculum = await this.prisma.curriculum.create({
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('curriculum', data),
      },
      include: { department: true, courses: true },
    });

    return this.hydrateCurriculum(curriculum);
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [curricula, total] = await Promise.all([
      this.prisma.curriculum.findMany({
        skip,
        take: limit,
        include: { department: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.curriculum.count(),
    ]);
    return {
      data: curricula.map((curriculum) => this.hydrateCurriculum(curriculum)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const curriculum = await this.prisma.curriculum.findUnique({
      where: { id },
      include: { department: true, courses: true },
    });
    if (!curriculum) throw new NotFoundException('Curriculum not found');
    return this.hydrateCurriculum(curriculum);
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.curriculum.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Curriculum not found');
    }

    const curriculum = await this.prisma.curriculum.update({
      where: { id },
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('curriculum', data, existing),
      },
      include: { department: true },
    });

    return this.hydrateCurriculum(curriculum);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.curriculum.delete({ where: { id } });
    return { message: 'Curriculum deleted successfully' };
  }

  private hydrateCurriculum<T extends { department?: any }>(curriculum: T) {
    return {
      ...hydrateLocalizedCatalogRecord('curriculum', curriculum as any),
      department: curriculum.department
        ? hydrateLocalizedCatalogRecord('department', curriculum.department)
        : curriculum.department,
    };
  }
}
