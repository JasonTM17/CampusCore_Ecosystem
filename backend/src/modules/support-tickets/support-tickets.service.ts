import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SupportTicketsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.supportTicket.create({ data, include: { user: true, assignedTo: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ skip, take: limit, include: { user: true, assignedTo: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.supportTicket.count(),
    ]);
    return { data: tickets, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, include: { user: true, assignedTo: true } });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return ticket;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.supportTicket.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.supportTicket.delete({ where: { id } });
    return { message: 'Support ticket deleted successfully' };
  }
}
