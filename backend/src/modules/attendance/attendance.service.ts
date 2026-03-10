import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.attendance.create({ data, include: { student: true, section: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({ skip, take: limit, include: { student: true, section: true }, orderBy: { date: 'desc' } }),
      this.prisma.attendance.count(),
    ]);
    return { data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const record = await this.prisma.attendance.findUnique({ where: { id }, include: { student: true, section: true } });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.attendance.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.attendance.delete({ where: { id } });
    return { message: 'Attendance record deleted successfully' };
  }
}
