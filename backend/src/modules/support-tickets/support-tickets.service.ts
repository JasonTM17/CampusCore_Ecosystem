import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SupportTicketsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    // Generate ticket number
    const count = await this.prisma.supportTicket.count();
    const ticketNumber = `TKT-${String(count + 1).padStart(5, '0')}`;

    return this.prisma.supportTicket.create({
      data: {
        ...data,
        ticketNumber,
      },
      include: { user: true },
    });
  }

  async findByUser(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { userId },
        skip,
        take: limit,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where: { userId } }),
    ]);
    return { data: tickets, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneByUser(id: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, userId },
      include: {
        user: true,
        responses: { include: { user: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return ticket;
  }

  async findAll(
    page = 1,
    limit = 20,
    status?: string,
    priority?: string,
    category?: string
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { data: tickets, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: true,
        responses: { include: { user: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return ticket;
  }

  async update(id: string, data: any) {
    await this.findOne(id);

    const updateData: any = { ...data };

    // Auto-set resolved/closed timestamps
    if (data.status === 'RESOLVED') {
      updateData.resolvedAt = new Date();
    } else if (data.status === 'CLOSED') {
      updateData.closedAt = new Date();
    }

    return this.prisma.supportTicket.update({
      where: { id },
      data: updateData,
      include: { user: true },
    });
  }

  async assign(id: string, assignedTo: string) {
    await this.findOne(id);
    return this.prisma.supportTicket.update({
      where: { id },
      data: { assignedTo },
      include: { user: true },
    });
  }

  async addResponse(ticketId: string, userId: string, message: string, isInternal = false) {
    const ticket = await this.findOne(ticketId);

    // Create response
    const response = await this.prisma.ticketResponse.create({
      data: {
        ticketId,
        userId,
        message,
        isInternal,
      },
      include: { user: true },
    });

    // Update ticket status if it's open
    if (ticket.status === 'OPEN') {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS' },
      });
    }

    return response;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.supportTicket.delete({ where: { id } });
    return { message: 'Support ticket deleted successfully' };
  }
}
