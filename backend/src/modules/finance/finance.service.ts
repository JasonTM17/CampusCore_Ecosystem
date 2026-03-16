import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Prisma, InvoiceStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  // ============ INVOICE METHODS ============

  async createInvoice(data: {
    studentId: string;
    semesterId: string;
    dueDate: Date;
    items: { description: string; quantity: number; unitPrice: number }[];
    notes?: string;
  }) {
    const subtotal = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    
    const invoiceNumber = await this.generateInvoiceNumber();

    return this.prisma.invoice.create({
      data: {
        invoiceNumber,
        studentId: data.studentId,
        semesterId: data.semesterId,
        dueDate: data.dueDate,
        notes: data.notes,
        subtotal,
        discount: 0,
        total: subtotal,
        status: InvoiceStatus.DRAFT,
        items: {
          create: data.items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
          })),
        },
      },
      include: {
        student: { include: { user: true } },
        semester: true,
        items: true,
      },
    });
  }

  async findAllInvoices(
    page = 1, 
    limit = 20, 
    status?: string, 
    semesterId?: string, 
    studentId?: string
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) {
      where.status = status;
    }
    if (semesterId) {
      where.semesterId = semesterId;
    }
    if (studentId) {
      where.studentId = studentId;
    }

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        skip,
        take: limit,
        where,
        include: {
          student: { include: { user: true } },
          semester: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data: invoices, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        student: { include: { user: true } },
        semester: true,
        items: true,
        payments: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async updateInvoice(id: string, data: { status?: string; notes?: string; dueDate?: Date }) {
    await this.findOneInvoice(id);
    
    const updateData: any = { ...data };
    
    // If marking as paid, set paidAt
    if (data.status === InvoiceStatus.PAID) {
      updateData.paidAt = new Date();
    }

    return this.prisma.invoice.update({
      where: { id },
      data: updateData,
      include: {
        student: { include: { user: true } },
        semester: true,
        items: true,
      },
    });
  }

  async removeInvoice(id: string) {
    await this.findOneInvoice(id);
    await this.prisma.invoice.delete({ where: { id } });
    return { message: 'Invoice deleted successfully' };
  }

  // ============ STUDENT INVOICE METHODS ============

  async getStudentInvoices(studentId: string, semesterId?: string) {
    const where: any = { studentId };
    if (semesterId) {
      where.semesterId = semesterId;
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        semester: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return invoices.map(invoice => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      semesterName: invoice.semester.name,
      semesterId: invoice.semesterId,
      status: invoice.status,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      createdAt: invoice.createdAt,
      paidAmount: invoice.payments
        .filter(p => p.status === PaymentStatus.COMPLETED)
        .reduce((sum, p) => sum + Number(p.amount), 0),
      balance: Number(invoice.total) - invoice.payments
        .filter(p => p.status === PaymentStatus.COMPLETED)
        .reduce((sum, p) => sum + Number(p.amount), 0),
    }));
  }

  async getStudentInvoiceById(studentId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, studentId },
      include: {
        student: { include: { user: true } },
        semester: true,
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    return {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      payments: invoice.payments.map(p => ({
        ...p,
        amount: Number(p.amount),
      })),
    };
  }

  // ============ PAYMENT METHODS ============

  async createPayment(data: {
    invoiceId: string;
    studentId: string;
    amount: number;
    method: string;
    transactionId?: string;
    notes?: string;
  }) {
    const invoice = await this.findOneInvoice(data.invoiceId);

    // Calculate current paid amount
    const currentPaid = await this.prisma.payment.aggregate({
      where: { 
        invoiceId: data.invoiceId,
        status: PaymentStatus.COMPLETED,
      },
      _sum: { amount: true },
    });

    const totalPaid = (currentPaid._sum.amount?.toNumber() || 0) + data.amount;
    
    // Create payment
    const paymentNumber = await this.generatePaymentNumber();
    const payment = await this.prisma.payment.create({
      data: {
        paymentNumber,
        invoiceId: data.invoiceId,
        studentId: data.studentId,
        amount: data.amount,
        method: data.method,
        transactionId: data.transactionId,
        notes: data.notes,
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
      },
      include: {
        invoice: true,
        student: { include: { user: true } },
      },
    });

    // Update invoice status if fully paid
    if (totalPaid >= Number(invoice.total)) {
      await this.prisma.invoice.update({
        where: { id: data.invoiceId },
        data: { 
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
        },
      });
    }

    return payment;
  }

  async findAllPayments(
    page = 1, 
    limit = 20, 
    status?: string, 
    invoiceId?: string, 
    studentId?: string
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) {
      where.status = status;
    }
    if (invoiceId) {
      where.invoiceId = invoiceId;
    }
    if (studentId) {
      where.studentId = studentId;
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        skip,
        take: limit,
        where,
        include: {
          invoice: true,
          student: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { 
      data: payments.map(p => ({
        ...p,
        amount: Number(p.amount),
      })), 
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) } 
    };
  }

  async findOnePayment(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: true,
        student: { include: { user: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return { ...payment, amount: Number(payment.amount) };
  }

  async updatePayment(id: string, data: { status?: string; notes?: string }) {
    await this.findOnePayment(id);
    return this.prisma.payment.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status as any }),
        ...(data.notes && { notes: data.notes }),
      },
      include: {
        invoice: true,
        student: { include: { user: true } },
      },
    });
  }

  async removePayment(id: string) {
    await this.findOnePayment(id);
    await this.prisma.payment.delete({ where: { id } });
    return { message: 'Payment deleted successfully' };
  }

  // ============ INVOICE GENERATION ============

  async generateInvoiceForStudentSemester(studentId: string, semesterId: string) {
    // Check if invoice already exists
    const existingInvoice = await this.prisma.invoice.findFirst({
      where: { studentId, semesterId },
    });

    if (existingInvoice) {
      throw new BadRequestException('Invoice already exists for this student and semester');
    }

    // Get student's enrollments for the semester
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId,
        semesterId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      include: {
        section: {
          include: { course: true },
        },
      },
    });

    if (enrollments.length === 0) {
      throw new BadRequestException('No confirmed enrollments found for this semester');
    }

    // Create invoice items from enrollments (per credit pricing)
    const tuitionPerCredit = 150; // Default tuition rate - could be configurable
    const items = enrollments.map(enrollment => ({
      description: `${enrollment.section.course.code} - ${enrollment.section.course.name} (${enrollment.section.course.credits} credits)`,
      quantity: enrollment.section.course.credits,
      unitPrice: tuitionPerCredit,
    }));

    // Get semester to set due date
    const semester = await this.prisma.semester.findUnique({
      where: { id: semesterId },
    });

    const dueDate = semester?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return this.createInvoice({
      studentId,
      semesterId,
      dueDate,
      items,
      notes: `Auto-generated invoice for ${semester?.name || 'semester'}`,
    });
  }

  async generateInvoicesForSemester(semesterId: string) {
    // Get all students with confirmed enrollments in this semester
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        semesterId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      select: { studentId: true },
      distinct: ['studentId'],
    });

    const results = {
      generated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const enrollment of enrollments) {
      try {
        await this.generateInvoiceForStudentSemester(enrollment.studentId, semesterId);
        results.generated++;
      } catch (error) {
        if (error instanceof BadRequestException) {
          results.skipped++;
        } else {
          results.errors.push(`Student ${enrollment.studentId}: ${error.message}`);
        }
      }
    }

    return results;
  }

  // ============ HELPER METHODS ============

  private async generateInvoiceNumber(): Promise<string> {
    const count = await this.prisma.invoice.count();
    const year = new Date().getFullYear();
    return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  private async generatePaymentNumber(): Promise<string> {
    const count = await this.prisma.payment.count();
    const year = new Date().getFullYear();
    return `PAY-${year}-${String(count + 1).padStart(5, '0')}`;
  }
}
