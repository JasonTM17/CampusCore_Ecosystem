import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  hydrateLocalizedCatalogRecord,
  normalizeLocalizedCatalogData,
} from '../common/catalog-localization';

@Injectable()
export class SemestersService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const semester = await this.prisma.semester.create({
      data: await this.normalizeSemesterData(data),
      include: { academicYear: true, sections: true },
    });

    return this.hydrateSemester(semester);
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [semesters, total] = await Promise.all([
      this.prisma.semester.findMany({
        skip,
        take: limit,
        include: { academicYear: true },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.semester.count(),
    ]);
    return {
      data: semesters.map((semester) => this.hydrateSemester(semester)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      include: { academicYear: true, sections: true },
    });
    if (!semester) throw new NotFoundException('Semester not found');
    return this.hydrateSemester(semester);
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.semester.findUnique({
      where: { id },
      include: { academicYear: true },
    });
    if (!existing) {
      throw new NotFoundException('Semester not found');
    }

    const semester = await this.prisma.semester.update({
      where: { id },
      data: await this.normalizeSemesterData(data, existing),
      include: { academicYear: true },
    });

    return this.hydrateSemester(semester);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.semester.delete({ where: { id } });
    return { message: 'Semester deleted successfully' };
  }

  private async normalizeSemesterData(data: any, existing?: any) {
    const academicYearId = data.academicYearId ?? existing?.academicYearId;
    const academicYear =
      academicYearId && academicYearId !== existing?.academicYear?.id
        ? await this.prisma.academicYear.findUnique({
            where: { id: academicYearId },
            select: { year: true },
          })
        : existing?.academicYear;

    return {
      ...data,
      ...normalizeLocalizedCatalogData(
        'semester',
        {
          ...data,
          academicYear: academicYear
            ? { year: academicYear.year }
            : existing?.academicYear
              ? { year: existing.academicYear.year }
              : undefined,
        },
        existing,
      ),
    };
  }

  private hydrateSemester<T>(semester: T) {
    return hydrateLocalizedCatalogRecord('semester', semester as any);
  }
}
