import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Invoice,
  InvoiceStatus,
  Payment,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CsvExportService } from '../common/services/csv-export.service';
import { EmailService } from '../common/services/email.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  FINANCE_EVENT_TYPES,
  FinanceEventEnvelope,
} from '../rabbitmq/rabbitmq.events';
import {
  CoreFinanceContextService,
  FinanceContextSemester,
  FinanceContextStudent,
} from './core-finance-context.service';

type InvoiceItemSeed = {
  description: string;
  quantity: number;
  unitPrice: number;
};

type CreateInvoiceInput = {
  studentId: string;
  semesterId: string;
  dueDate: Date;
  items: InvoiceItemSeed[];
  notes?: string;
};

type CreatePaymentInput = {
  invoiceId: string;
  studentId: string;
  amount: number;
  method: string;
  transactionId?: string;
  notes?: string;
};

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly csvExportService: CsvExportService,
    private readonly emailService: EmailService,
    private readonly rabbitMQService: RabbitMQService,
    private readonly coreFinanceContextService: CoreFinanceContextService,
  ) {}

  async createInvoice(data: CreateInvoiceInput) {
    const student = await this.coreFinanceContextService.getStudent(
      data.studentId,
    );
    const semester = await this.coreFinanceContextService.getSemester(
      data.semesterId,
    );

    return this.createInvoiceRecord(student, semester, data.items, {
      dueDate: data.dueDate,
      notes: data.notes,
    });
  }

  async findAllInvoices(
    page = 1,
    limit = 20,
    status?: string,
    semesterId?: string,
    studentId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.InvoiceWhereInput = {};

    if (status) {
      where.status = status as InvoiceStatus;
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
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices.map((invoice) => this.toInvoiceListItem(invoice)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async exportInvoices(
    status?: string,
    semesterId?: string,
    studentId?: string,
  ) {
    const where: Prisma.InvoiceWhereInput = {};

    if (status) {
      where.status = status as InvoiceStatus;
    }
    if (semesterId) {
      where.semesterId = semesterId;
    }
    if (studentId) {
      where.studentId = studentId;
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const exportData = invoices.map((invoice) => {
      const paidAmount = this.calculatePaidAmount(invoice.payments);
      return {
        invoiceNumber: invoice.invoiceNumber,
        studentName: invoice.studentDisplayName,
        studentEmail: invoice.studentEmail,
        studentNumber: invoice.studentCode,
        semesterName: invoice.semesterName,
        status: invoice.status,
        subtotal: Number(invoice.subtotal),
        discount: Number(invoice.discount),
        total: Number(invoice.total),
        dueDate: invoice.dueDate.toISOString(),
        paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : '',
        paidAmount,
        balance: Number(invoice.total) - paidAmount,
        notes: invoice.notes ?? '',
        createdAt: invoice.createdAt.toISOString(),
      };
    });

    return this.csvExportService.generateCsv(exportData);
  }

  async findOneInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return this.toInvoiceDetail(invoice);
  }

  async updateInvoice(
    id: string,
    data: { status?: InvoiceStatus; notes?: string; dueDate?: Date },
  ) {
    const existing = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Invoice not found');
    }

    const nextStatus = data.status ?? existing.status;
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.dueDate ? { dueDate: data.dueDate } : {}),
        ...(nextStatus === InvoiceStatus.PAID ? { paidAt: new Date() } : {}),
      },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (existing.status !== updated.status) {
      await this.publishInvoiceStatusChanged(updated);
    }

    return this.toInvoiceDetail(updated);
  }

  async removeInvoice(id: string) {
    await this.findOneInvoice(id);
    await this.prisma.invoice.delete({ where: { id } });
    return { message: 'Invoice deleted successfully' };
  }

  async getStudentInvoices(studentId: string, semesterId?: string) {
    const where: Prisma.InvoiceWhereInput = { studentId };
    if (semesterId) {
      where.semesterId = semesterId;
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      semesterName: invoice.semesterName,
      semesterId: invoice.semesterId,
      status: invoice.status,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      createdAt: invoice.createdAt,
      paidAmount: this.calculatePaidAmount(invoice.payments),
      balance:
        Number(invoice.total) - this.calculatePaidAmount(invoice.payments),
    }));
  }

  async getStudentInvoiceById(studentId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, studentId },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return this.toInvoiceDetail(invoice);
  }

  async createPayment(data: CreatePaymentInput) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: data.invoiceId },
      include: {
        payments: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.studentId !== data.studentId) {
      throw new ForbiddenException('Payment does not belong to this student');
    }

    const currentPaid = this.calculatePaidAmount(invoice.payments);
    const totalPaid = currentPaid + data.amount;
    const invoiceTotal = Number(invoice.total);

    if (totalPaid > invoiceTotal) {
      throw new BadRequestException(
        'Payment exceeds outstanding invoice balance',
      );
    }

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
      },
    });

    const nextInvoiceStatus =
      totalPaid >= invoiceTotal
        ? InvoiceStatus.PAID
        : totalPaid > 0
          ? InvoiceStatus.PARTIALLY_PAID
          : invoice.status;

    const updatedInvoice = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: nextInvoiceStatus,
        ...(nextInvoiceStatus === InvoiceStatus.PAID
          ? { paidAt: new Date() }
          : {}),
      },
    });

    if (invoice.studentEmail) {
      this.emailService
        .sendPaymentConfirmation(
          invoice.studentEmail,
          invoice.studentDisplayName,
          invoice.invoiceNumber,
          Number(payment.amount),
        )
        .catch((error) => {
          this.logger.error('Failed to send payment confirmation email', error);
        });
    }

    await this.publishPaymentCompleted(updatedInvoice, payment);

    return {
      ...payment,
      amount: Number(payment.amount),
    };
  }

  async findAllPayments(
    page = 1,
    limit = 20,
    status?: string,
    invoiceId?: string,
    studentId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.PaymentWhereInput = {};

    if (status) {
      where.status = status as PaymentStatus;
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
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async exportPayments(
    status?: string,
    invoiceId?: string,
    studentId?: string,
  ) {
    const where: Prisma.PaymentWhereInput = {};

    if (status) {
      where.status = status as PaymentStatus;
    }
    if (invoiceId) {
      where.invoiceId = invoiceId;
    }
    if (studentId) {
      where.studentId = studentId;
    }

    const payments = await this.prisma.payment.findMany({
      where,
      include: {
        invoice: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const exportData = payments.map((payment) => ({
      paymentNumber: payment.paymentNumber,
      invoiceNumber: payment.invoice.invoiceNumber,
      studentName: payment.invoice.studentDisplayName,
      studentEmail: payment.invoice.studentEmail,
      studentNumber: payment.invoice.studentCode,
      amount: Number(payment.amount),
      method: payment.method,
      status: payment.status,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : '',
      transactionId: payment.transactionId ?? '',
      notes: payment.notes ?? '',
      createdAt: payment.createdAt.toISOString(),
    }));

    return this.csvExportService.generateCsv(exportData);
  }

  async findOnePayment(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return {
      ...payment,
      amount: Number(payment.amount),
    };
  }

  async updatePayment(
    id: string,
    data: { status?: PaymentStatus; notes?: string },
  ) {
    await this.findOnePayment(id);
    const payment = await this.prisma.payment.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      include: {
        invoice: true,
      },
    });

    return {
      ...payment,
      amount: Number(payment.amount),
    };
  }

  async removePayment(id: string) {
    await this.findOnePayment(id);
    await this.prisma.payment.delete({ where: { id } });
    return { message: 'Payment deleted successfully' };
  }

  async generateInvoiceForStudentSemester(
    studentId: string,
    semesterId: string,
  ) {
    const existingInvoice = await this.prisma.invoice.findFirst({
      where: { studentId, semesterId },
    });

    if (existingInvoice) {
      throw new BadRequestException(
        'Invoice already exists for this student and semester',
      );
    }

    const semester =
      await this.coreFinanceContextService.getSemester(semesterId);
    const billableStudents =
      await this.coreFinanceContextService.getBillableStudents(semesterId);
    const billableStudent = billableStudents.students.find(
      (student) => student.id === studentId,
    );

    if (!billableStudent || billableStudent.items.length === 0) {
      throw new BadRequestException(
        'No confirmed enrollments found for this semester',
      );
    }

    const dueDate = semester.endDate
      ? new Date(semester.endDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return this.createInvoiceRecord(
      billableStudent,
      semester,
      billableStudent.items,
      {
        dueDate,
        notes: `Auto-generated invoice for ${semester.name}`,
      },
    );
  }

  async generateInvoicesForSemester(semesterId: string) {
    const semester =
      await this.coreFinanceContextService.getSemester(semesterId);
    const billableStudents =
      await this.coreFinanceContextService.getBillableStudents(semesterId);

    const results = {
      generated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    const dueDate = semester.endDate
      ? new Date(semester.endDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    for (const student of billableStudents.students) {
      try {
        const existingInvoice = await this.prisma.invoice.findFirst({
          where: {
            studentId: student.id,
            semesterId,
          },
        });

        if (existingInvoice) {
          results.skipped++;
          continue;
        }

        if (student.items.length === 0) {
          results.skipped++;
          continue;
        }

        await this.createInvoiceRecord(student, semester, student.items, {
          dueDate,
          notes: `Auto-generated invoice for ${semester.name}`,
        });
        results.generated++;
      } catch (error) {
        results.errors.push(
          `Student ${student.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return results;
  }

  private async createInvoiceRecord(
    student: FinanceContextStudent,
    semester: FinanceContextSemester,
    items: InvoiceItemSeed[],
    options: { dueDate: Date; notes?: string },
  ) {
    if (items.length === 0) {
      throw new BadRequestException('Invoice must contain at least one item');
    }

    const subtotal = items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );

    const invoiceNumber = await this.generateInvoiceNumber();
    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        studentId: student.id,
        studentUserId: student.userId,
        studentDisplayName: student.displayName,
        studentEmail: student.email,
        studentCode: student.studentCode,
        semesterId: semester.id,
        semesterName: semester.name,
        dueDate: options.dueDate,
        notes: options.notes,
        subtotal,
        discount: 0,
        total: subtotal,
        status: InvoiceStatus.DRAFT,
        items: {
          create: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
          })),
        },
      },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    await this.publishInvoiceCreated(invoice);

    return this.toInvoiceDetail(invoice);
  }

  private toInvoiceListItem(
    invoice: Prisma.InvoiceGetPayload<{ include: { payments: true } }>,
  ) {
    const paidAmount = this.calculatePaidAmount(invoice.payments);
    return {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      paidAmount,
      balance: Number(invoice.total) - paidAmount,
      student: {
        user: {
          firstName: invoice.studentDisplayName
            .split(' ')
            .slice(0, -1)
            .join(' '),
          lastName: invoice.studentDisplayName.split(' ').slice(-1).join(' '),
          email: invoice.studentEmail,
        },
        studentId: invoice.studentCode,
      },
      semester: {
        name: invoice.semesterName,
      },
    };
  }

  private toInvoiceDetail(
    invoice: Prisma.InvoiceGetPayload<{
      include: {
        items: true;
        payments: true;
      };
    }>,
  ) {
    return {
      ...this.toInvoiceListItem(invoice),
      items: invoice.items.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        total: Number(item.total),
      })),
      payments: invoice.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
    };
  }

  private calculatePaidAmount(
    payments: Array<{ amount: Prisma.Decimal; status: PaymentStatus }>,
  ) {
    return payments
      .filter((payment) => payment.status === PaymentStatus.COMPLETED)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
  }

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

  private async publishInvoiceCreated(
    invoice: Prisma.InvoiceGetPayload<{
      include: {
        items: true;
        payments: true;
      };
    }>,
  ) {
    const event: FinanceEventEnvelope<{
      userId: string;
      notification: {
        title: string;
        message: string;
        type: string;
        link: string;
      };
      invoice: {
        id: string;
        invoiceNumber: string;
        total: number;
        dueDate: string;
        semesterName: string;
      };
    }> = {
      type: FINANCE_EVENT_TYPES.INVOICE_CREATED,
      source: 'campuscore-finance-service',
      occurredAt: new Date().toISOString(),
      payload: {
        userId: invoice.studentUserId,
        notification: {
          title: `Invoice ${invoice.invoiceNumber} created`,
          message: `A new invoice for ${invoice.semesterName} is now available in your billing dashboard.`,
          type: 'INFO',
          link: '/dashboard/invoices',
        },
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          total: Number(invoice.total),
          dueDate: invoice.dueDate.toISOString(),
          semesterName: invoice.semesterName,
        },
      },
    };

    await this.rabbitMQService.publishMessage(event);
  }

  private async publishInvoiceStatusChanged(invoice: Invoice) {
    const event: FinanceEventEnvelope<{
      userId: string;
      invoice: {
        id: string;
        invoiceNumber: string;
        status: string;
      };
    }> = {
      type: FINANCE_EVENT_TYPES.INVOICE_STATUS_CHANGED,
      source: 'campuscore-finance-service',
      occurredAt: new Date().toISOString(),
      payload: {
        userId: invoice.studentUserId,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
        },
      },
    };

    await this.rabbitMQService.publishMessage(event);
  }

  private async publishPaymentCompleted(invoice: Invoice, payment: Payment) {
    const event: FinanceEventEnvelope<{
      userId: string;
      notification: {
        title: string;
        message: string;
        type: string;
        link: string;
      };
      payment: {
        id: string;
        paymentNumber: string;
        amount: number;
      };
      invoice: {
        id: string;
        invoiceNumber: string;
      };
    }> = {
      type: FINANCE_EVENT_TYPES.PAYMENT_COMPLETED,
      source: 'campuscore-finance-service',
      occurredAt: new Date().toISOString(),
      payload: {
        userId: invoice.studentUserId,
        notification: {
          title: `Payment ${payment.paymentNumber} completed`,
          message: `Payment for invoice ${invoice.invoiceNumber} has been recorded successfully.`,
          type: 'SUCCESS',
          link: '/dashboard/invoices',
        },
        payment: {
          id: payment.id,
          paymentNumber: payment.paymentNumber,
          amount: Number(payment.amount),
        },
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        },
      },
    };

    await this.rabbitMQService.publishMessage(event);
  }
}
