import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.finance.create({ data, include: { student: true, academicYear: true, semester: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [finances, total] = await Promise.all([
      this.prisma.finance.findMany({ skip, take: limit, include: { student: true, academicYear: true, semester: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.finance.count(),
    ]);
    return { data: finances, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const finance = await this.prisma.finance.findUnique({ where: { id }, include: { student: true, academicYear: true, semester: true } });
    if (!finance) throw new NotFoundException('Finance record not found');
    return finance;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.finance.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.finance.delete({ where: { id } });
    return { message: 'Finance record deleted successfully' };
  }
}
