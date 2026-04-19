import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';

type SupportTicketRecord = {
  id: string;
  ticketNumber: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedToDisplayName: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  responses?: TicketResponseRecord[];
};

type TicketResponseRecord = {
  id: string;
  ticketId: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  message: string;
  isInternal: boolean;
  createdAt: Date;
};

@Injectable()
export class SupportTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    userEmail: string;
    userDisplayName?: string | null;
    subject: string;
    description: string;
    category: string;
    priority?: string;
  }) {
    const count = await this.prisma.supportTicket.count();
    const ticketNumber = `TKT-${String(count + 1).padStart(5, '0')}`;

    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber,
        userId: data.userId,
        userEmail: data.userEmail,
        userDisplayName: data.userDisplayName ?? null,
        subject: data.subject,
        description: data.description,
        category: data.category,
        priority:
          (data.priority as
            | 'LOW'
            | 'MEDIUM'
            | 'HIGH'
            | 'CRITICAL'
            | undefined) ?? 'MEDIUM',
      },
      include: { responses: { orderBy: { createdAt: 'asc' } } },
    });

    return this.mapTicket(ticket);
  }

  async findByUser(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { userId },
        skip,
        take: limit,
        include: { responses: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where: { userId } }),
    ]);

    return {
      data: tickets.map((ticket) => this.mapTicket(ticket)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOneByUser(id: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, userId },
      include: { responses: { orderBy: { createdAt: 'asc' } } },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    return this.mapTicket(ticket);
  }

  async findAll(
    page = 1,
    limit = 20,
    status?: string,
    priority?: string,
    category?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }
    if (priority) {
      where.priority = priority;
    }
    if (category) {
      where.category = category;
    }

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        include: { responses: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      data: tickets.map((ticket) => this.mapTicket(ticket)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { responses: { orderBy: { createdAt: 'asc' } } },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    return this.mapTicket(ticket);
  }

  async update(id: string, data: UpdateSupportTicketDto) {
    await this.findOne(id);
    const updateData: Record<string, unknown> = { ...data };

    if (data.status === 'RESOLVED') {
      updateData.resolvedAt = new Date();
    } else if (data.status === 'CLOSED') {
      updateData.closedAt = new Date();
    }

    const ticket = await this.prisma.supportTicket.update({
      where: { id },
      data: updateData,
      include: { responses: { orderBy: { createdAt: 'asc' } } },
    });

    return this.mapTicket(ticket);
  }

  async assign(id: string, assignedTo: string) {
    await this.findOne(id);
    const ticket = await this.prisma.supportTicket.update({
      where: { id },
      data: { assignedTo },
      include: { responses: { orderBy: { createdAt: 'asc' } } },
    });

    return this.mapTicket(ticket);
  }

  async addResponse(
    ticketId: string,
    userId: string,
    userEmail: string,
    userDisplayName: string | null,
    message: string,
    isInternal = false,
  ) {
    const ticket = await this.findOne(ticketId);

    const response = await this.prisma.ticketResponse.create({
      data: {
        ticketId,
        userId,
        userEmail,
        userDisplayName,
        message,
        isInternal,
      },
    });

    if (ticket.status === 'OPEN') {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS' },
      });
    }

    return this.mapResponse(response);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.supportTicket.delete({ where: { id } });
    return { message: 'Support ticket deleted successfully' };
  }

  private mapTicket(ticket: SupportTicketRecord) {
    return {
      ...ticket,
      user: {
        id: ticket.userId,
        email: ticket.userEmail,
        displayName: ticket.userDisplayName ?? ticket.userEmail,
      },
      responses: (ticket.responses ?? []).map((response) =>
        this.mapResponse(response),
      ),
    };
  }

  private mapResponse(response: TicketResponseRecord) {
    return {
      ...response,
      user: {
        id: response.userId,
        email: response.userEmail,
        displayName: response.userDisplayName ?? response.userEmail,
      },
    };
  }
}
