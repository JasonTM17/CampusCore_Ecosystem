import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Invoice,
  InvoiceStatus,
  Payment,
  PaymentAttemptStatus,
  PaymentIntentEventType,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentSignalSource,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { ENV } from '../../config/env.constants';
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
import { InitiatePaymentIntentDto } from './dto/initiate-payment-intent.dto';
import { ProviderSignalDto } from './dto/provider-signal.dto';
import { SimulateSandboxPaymentSignalDto } from './dto/simulate-sandbox-payment-signal.dto';
import {
  SandboxPaymentSignalStatus,
  buildSandboxProviderNextAction,
  createSandboxProviderReference,
  createPaymentAttemptNumber,
  createPaymentAttemptToken,
  createPaymentIntentNumber,
  getPaymentProviderSegment,
  parsePaymentProvider,
  signSandboxPaymentSignal,
  verifySandboxPaymentSignal,
} from './payment-orchestration.util';

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

const paymentIntentDetailInclude = {
  invoice: {
    include: {
      payments: true,
    },
  },
  payment: true,
  attempts: {
    orderBy: {
      createdAt: 'desc',
    },
  },
  events: {
    orderBy: {
      createdAt: 'asc',
    },
  },
} satisfies Prisma.PaymentIntentInclude;

const paymentAttemptWithIntentInclude = {
  intent: {
    include: paymentIntentDetailInclude,
  },
} satisfies Prisma.PaymentAttemptInclude;

type PaymentIntentDetail = Prisma.PaymentIntentGetPayload<{
  include: typeof paymentIntentDetailInclude;
}>;

const ACTIVE_INTENT_STATUSES: PaymentIntentStatus[] = [
  PaymentIntentStatus.REQUIRES_ACTION,
  PaymentIntentStatus.PROCESSING,
];

const ACTIVE_ATTEMPT_STATUSES: PaymentAttemptStatus[] = [
  PaymentAttemptStatus.CREATED,
  PaymentAttemptStatus.REDIRECT_REQUIRED,
  PaymentAttemptStatus.PROCESSING,
];

const TERMINAL_INTENT_STATUSES: PaymentIntentStatus[] = [
  PaymentIntentStatus.SUCCEEDED,
  PaymentIntentStatus.FAILED,
  PaymentIntentStatus.CANCELLED,
  PaymentIntentStatus.EXPIRED,
];

const TERMINAL_ATTEMPT_STATUSES: PaymentAttemptStatus[] = [
  PaymentAttemptStatus.SUCCEEDED,
  PaymentAttemptStatus.FAILED,
  PaymentAttemptStatus.CANCELLED,
  PaymentAttemptStatus.EXPIRED,
];

const SANDBOX_INTENT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CURRENCY = 'VND';

type InvoiceSemesterSnapshot = {
  name: string;
  nameEn: string;
  nameVi: string | null;
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
    private readonly configService: ConfigService,
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
      const displayStatus = this.resolveDisplayInvoiceStatus(
        Number(invoice.total),
        invoice.dueDate,
        invoice.status,
        invoice.payments,
      );
      const displayPaidAt = this.resolveDisplayPaidAt(
        invoice.paidAt,
        invoice.payments,
        displayStatus,
      );

      return {
        invoiceNumber: invoice.invoiceNumber,
        studentName: invoice.studentDisplayName,
        studentEmail: invoice.studentEmail,
        studentNumber: invoice.studentCode,
        semesterName: invoice.semesterName,
        status: displayStatus,
        subtotal: Number(invoice.subtotal),
        discount: Number(invoice.discount),
        total: Number(invoice.total),
        dueDate: invoice.dueDate.toISOString(),
        paidAt: displayPaidAt ? displayPaidAt.toISOString() : '',
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

    const paymentIntentCount = await this.prisma.paymentIntent.count({
      where: { invoiceId: id },
    });

    if (paymentIntentCount > 0) {
      throw new BadRequestException(
        'Invoices with payment checkout history cannot be deleted',
      );
    }

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

    return invoices.map((invoice) => {
      const paidAmount = this.calculatePaidAmount(invoice.payments);
      const semesterSnapshot = this.resolveInvoiceSemesterSnapshot(invoice);
      const status = this.resolveDisplayInvoiceStatus(
        Number(invoice.total),
        invoice.dueDate,
        invoice.status,
        invoice.payments,
      );

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        semesterName: semesterSnapshot.name,
        semesterNameEn: semesterSnapshot.nameEn,
        semesterNameVi: semesterSnapshot.nameVi,
        semesterId: invoice.semesterId,
        status,
        subtotal: Number(invoice.subtotal),
        discount: Number(invoice.discount),
        total: Number(invoice.total),
        dueDate: invoice.dueDate,
        paidAt: this.resolveDisplayPaidAt(
          invoice.paidAt,
          invoice.payments,
          status,
        ),
        createdAt: invoice.createdAt,
        paidAmount,
        balance: Number(invoice.total) - paidAmount,
      };
    });
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

  async initiateStudentInvoiceCheckout(
    studentId: string,
    invoiceId: string,
    data: InitiatePaymentIntentDto,
    headerIdempotencyKey?: string,
  ) {
    const provider = parsePaymentProvider(String(data.provider));
    const idempotencyKey = (
      headerIdempotencyKey ?? data.idempotencyKey
    )?.trim();

    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new BadRequestException(
        'A valid idempotency key is required for checkout initiation',
      );
    }

    const existingAttempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        invoiceId,
        studentId,
        provider,
        idempotencyKey,
      },
      include: paymentAttemptWithIntentInclude,
      orderBy: { createdAt: 'desc' },
    });

    if (existingAttempt) {
      return this.toPaymentIntentResponse(
        existingAttempt.intent,
        existingAttempt,
      );
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        studentId,
      },
      include: {
        payments: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        'Cancelled invoices cannot be used for checkout',
      );
    }

    const outstandingAmount = this.calculateOutstandingAmount(
      Number(invoice.total),
      invoice.payments,
    );

    if (outstandingAmount <= 0) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    let activeIntent = await this.prisma.paymentIntent.findFirst({
      where: {
        invoiceId,
        studentId,
        status: {
          in: ACTIVE_INTENT_STATUSES,
        },
      },
      include: paymentIntentDetailInclude,
      orderBy: { createdAt: 'desc' },
    });

    if (activeIntent && this.shouldExpireIntent(activeIntent)) {
      await this.expirePaymentIntent(
        activeIntent,
        'intent-expired-before-reuse',
      );
      activeIntent = null;
    }

    if (activeIntent && activeIntent.provider !== provider) {
      throw new BadRequestException(
        'Another payment provider checkout is already active for this invoice',
      );
    }

    if (activeIntent?.status === PaymentIntentStatus.PROCESSING) {
      throw new BadRequestException('The current checkout is still processing');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SANDBOX_INTENT_TTL_MS);
      let intentId = activeIntent?.id;

      if (!intentId) {
        const createdIntent = await tx.paymentIntent.create({
          data: {
            intentNumber: createPaymentIntentNumber(),
            invoiceId,
            studentId,
            provider,
            amount: outstandingAmount,
            currency: DEFAULT_CURRENCY,
            metadata: this.toJsonValue({
              initiatedBy: 'student-checkout',
            }),
            expiresAt,
          },
        });

        intentId = createdIntent.id;

        await this.appendPaymentIntentEventTx(tx, {
          paymentIntentId: createdIntent.id,
          type: PaymentIntentEventType.INTENT_CREATED,
          source: PaymentSignalSource.INITIATION,
          provider,
          toIntentStatus: createdIntent.status,
          payload: {
            invoiceId,
            studentId,
            amount: outstandingAmount,
            currency: DEFAULT_CURRENCY,
            expiresAt: expiresAt.toISOString(),
          },
        });

        if (invoice.status === InvoiceStatus.DRAFT) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: InvoiceStatus.PENDING },
          });
        }
      }

      const providerSegment = getPaymentProviderSegment(provider);
      const publicToken = createPaymentAttemptToken();
      const attemptNumber = createPaymentAttemptNumber();
      const callbackUrl = `/api/v1/finance/payment-providers/${providerSegment}/callback/${publicToken}`;
      const webhookUrl = `/api/v1/finance/payment-providers/${providerSegment}/webhook/${publicToken}`;
      const handoffUrl = `/api/v1/finance/payment-providers/${providerSegment}/handoff/${publicToken}`;
      const providerReference = createSandboxProviderReference(
        provider,
        attemptNumber,
      );
      const nextAction = buildSandboxProviderNextAction({
        provider,
        handoffUrl,
        publicToken,
      });

      const attempt = await tx.paymentAttempt.create({
        data: {
          attemptNumber,
          intentId,
          invoiceId,
          studentId,
          provider,
          status: PaymentAttemptStatus.REDIRECT_REQUIRED,
          idempotencyKey,
          publicToken,
          amount: outstandingAmount,
          currency: DEFAULT_CURRENCY,
          providerReference,
          callbackUrl,
          webhookUrl,
          returnUrl: data.returnUrl,
          cancelUrl: data.cancelUrl,
          providerPayload: this.toJsonValue({
            mode: 'sandbox',
            callbackUrl,
            webhookUrl,
            handoffUrl,
            providerReference,
            returnUrl: data.returnUrl ?? null,
            cancelUrl: data.cancelUrl ?? null,
            nextAction,
          }),
        },
      });

      await this.appendPaymentIntentEventTx(tx, {
        paymentIntentId: intentId,
        paymentAttemptId: attempt.id,
        type: PaymentIntentEventType.ATTEMPT_CREATED,
        source: PaymentSignalSource.INITIATION,
        provider,
        toAttemptStatus: attempt.status,
        payload: {
          idempotencyKey,
          callbackUrl,
          webhookUrl,
          handoffUrl,
          providerReference,
          nextAction,
          returnUrl: data.returnUrl ?? null,
          cancelUrl: data.cancelUrl ?? null,
        },
      });

      const intent = await tx.paymentIntent.findUnique({
        where: { id: intentId },
        include: paymentIntentDetailInclude,
      });

      if (!intent) {
        throw new NotFoundException('Payment intent not found after creation');
      }

      return {
        intent,
        attemptId: attempt.id,
      };
    });

    const selectedAttempt =
      result.intent.attempts.find(
        (attempt) => attempt.id === result.attemptId,
      ) ?? result.intent.attempts[0];

    return this.toPaymentIntentResponse(result.intent, selectedAttempt);
  }

  async getStudentPaymentIntent(studentId: string, intentId: string) {
    let intent = await this.prisma.paymentIntent.findFirst({
      where: {
        id: intentId,
        studentId,
      },
      include: paymentIntentDetailInclude,
    });

    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }

    if (this.shouldExpireIntent(intent)) {
      await this.expirePaymentIntent(intent, 'intent-expired-on-read');
      intent = await this.prisma.paymentIntent.findFirst({
        where: {
          id: intentId,
          studentId,
        },
        include: paymentIntentDetailInclude,
      });

      if (!intent) {
        throw new NotFoundException('Payment intent not found');
      }
    }

    return this.toPaymentIntentResponse(intent);
  }

  async signalStudentSandboxPaymentIntent(
    studentId: string,
    intentId: string,
    data: SimulateSandboxPaymentSignalDto,
  ) {
    let intent = await this.prisma.paymentIntent.findFirst({
      where: {
        id: intentId,
        studentId,
      },
      include: paymentIntentDetailInclude,
    });

    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }

    if (this.shouldExpireIntent(intent)) {
      await this.expirePaymentIntent(intent, 'intent-expired-before-signal');
      intent = await this.prisma.paymentIntent.findFirst({
        where: {
          id: intentId,
          studentId,
        },
        include: paymentIntentDetailInclude,
      });

      if (!intent) {
        throw new NotFoundException('Payment intent not found');
      }
    }

    if (this.isIntentTerminal(intent.status)) {
      throw new BadRequestException(
        'This sandbox checkout is already finalized',
      );
    }

    const attempt =
      intent.attempts.find((item) => !this.isAttemptTerminal(item.status)) ??
      intent.attempts[0];

    if (!attempt) {
      throw new BadRequestException(
        'No sandbox payment attempt is available for this checkout',
      );
    }

    const providerTransactionId =
      data.providerTransactionId?.trim() ||
      `${intent.provider.toLowerCase()}-sandbox-${Date.now()}`;
    const signature = signSandboxPaymentSignal(this.getSandboxSharedSecret(), {
      provider: intent.provider,
      attemptToken: attempt.publicToken,
      status: data.status,
      providerTransactionId,
    });

    return this.processProviderSignal(
      intent.provider,
      attempt.publicToken,
      {
        status: data.status,
        signature,
        providerTransactionId,
        occurredAt: new Date(),
        payload: {
          initiatedBy: 'student-sandbox-flow',
        },
      },
      PaymentSignalSource.CALLBACK,
    );
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

  async handlePaymentProviderCallback(
    providerValue: string,
    token: string,
    signal: ProviderSignalDto,
  ) {
    return this.processProviderSignal(
      providerValue,
      token,
      signal,
      PaymentSignalSource.CALLBACK,
    );
  }

  async handlePaymentProviderWebhook(
    providerValue: string,
    token: string,
    signal: ProviderSignalDto,
  ) {
    return this.processProviderSignal(
      providerValue,
      token,
      signal,
      PaymentSignalSource.WEBHOOK,
    );
  }

  async getSandboxProviderHandoff(providerValue: string, token: string) {
    const { attempt, intent } = await this.findSandboxAttempt(
      providerValue,
      token,
    );
    const providerLabels = this.getProviderLabels(intent.provider);

    return {
      locale: this.resolveCheckoutLocale(attempt.returnUrl, attempt.cancelUrl),
      provider: intent.provider,
      providerLabel: providerLabels,
      invoiceNumber: intent.invoice.invoiceNumber,
      semesterName: intent.invoice.semesterName,
      semesterNameEn:
        intent.invoice.semesterNameEn ?? intent.invoice.semesterName,
      semesterNameVi: intent.invoice.semesterNameVi ?? null,
      amount: Number(intent.amount),
      currency: intent.currency,
      expiresAt: intent.expiresAt,
      nextAction:
        this.resolveAttemptNextAction(attempt) ??
        buildSandboxProviderNextAction({
          provider: intent.provider,
          handoffUrl: `/api/v1/finance/payment-providers/${getPaymentProviderSegment(
            intent.provider,
          )}/handoff/${attempt.publicToken}`,
          publicToken: attempt.publicToken,
        }),
    };
  }

  async completeSandboxProviderHandoff(
    providerValue: string,
    token: string,
    status: SandboxPaymentSignalStatus,
  ) {
    const { attempt, intent } = await this.findSandboxAttempt(
      providerValue,
      token,
    );
    const providerTransactionId = `${getPaymentProviderSegment(
      intent.provider,
    )}-sandbox-${Date.now()}`;
    const signature = signSandboxPaymentSignal(this.getSandboxSharedSecret(), {
      provider: intent.provider,
      attemptToken: token,
      status,
      providerTransactionId,
    });

    await this.processProviderSignal(
      providerValue,
      token,
      {
        status,
        signature,
        providerTransactionId,
        occurredAt: new Date(),
        payload: {
          source: 'provider-handoff-page',
        },
      },
      PaymentSignalSource.CALLBACK,
    );

    const target =
      status === SandboxPaymentSignalStatus.CANCELLED
        ? attempt.cancelUrl || attempt.returnUrl
        : attempt.returnUrl || attempt.cancelUrl;

    return this.buildCheckoutReturnUrl(
      target,
      intent.invoiceId,
      intent.id,
      intent.provider,
      status,
    );
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
    const existing = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Payment not found');
    }

    if (
      existing.paymentIntentId &&
      data.status &&
      data.status !== existing.status
    ) {
      throw new BadRequestException(
        'Managed checkout payments are append-only and cannot change status manually',
      );
    }

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
    const payment = await this.prisma.payment.findUnique({
      where: { id },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.paymentIntentId) {
      throw new BadRequestException(
        'Managed checkout payments are append-only and cannot be deleted',
      );
    }

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
        notes: `Auto-generated invoice for ${semester.nameEn ?? semester.name}`,
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
          notes: `Auto-generated invoice for ${semester.nameEn ?? semester.name}`,
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

  private async processProviderSignal(
    providerValue: string,
    token: string,
    signal: ProviderSignalDto,
    source: PaymentSignalSource,
  ) {
    const provider = parsePaymentProvider(providerValue);
    const existingAttempt = await this.prisma.paymentAttempt.findUnique({
      where: { publicToken: token },
      include: paymentAttemptWithIntentInclude,
    });

    if (!existingAttempt || existingAttempt.provider !== provider) {
      throw new NotFoundException('Payment attempt not found');
    }

    const occurredAt = signal.occurredAt ?? new Date();
    const verified = this.verifySandboxSignal(provider, token, signal);

    const result = await this.prisma.$transaction(async (tx) => {
      const currentAttempt = await tx.paymentAttempt.findUnique({
        where: { id: existingAttempt.id },
        include: paymentAttemptWithIntentInclude,
      });

      if (!currentAttempt || currentAttempt.provider !== provider) {
        throw new NotFoundException('Payment attempt not found');
      }

      const currentIntent = currentAttempt.intent;
      let invoiceRecord: Invoice = currentIntent.invoice;
      let paymentRecord: Payment | null = currentIntent.payment;
      let paymentCreated = false;
      let requiresManualReview = false;

      await this.appendPaymentIntentEventTx(tx, {
        paymentIntentId: currentIntent.id,
        paymentAttemptId: currentAttempt.id,
        type: PaymentIntentEventType.SIGNAL_RECEIVED,
        source,
        provider,
        payload: {
          status: signal.status,
          providerTransactionId: signal.providerTransactionId ?? null,
          occurredAt: occurredAt.toISOString(),
          payload: signal.payload ?? null,
        },
      });

      await tx.paymentAttempt.update({
        where: { id: currentAttempt.id },
        data: {
          occurredAt,
          ...(signal.providerTransactionId
            ? { providerReference: signal.providerTransactionId }
            : {}),
        },
      });

      if (!verified) {
        await this.appendPaymentIntentEventTx(tx, {
          paymentIntentId: currentIntent.id,
          paymentAttemptId: currentAttempt.id,
          type: PaymentIntentEventType.VERIFICATION_FAILED,
          source,
          provider,
          payload: {
            reason: 'sandbox-signature-mismatch',
          },
        });

        const intent = await tx.paymentIntent.findUnique({
          where: { id: currentIntent.id },
          include: paymentIntentDetailInclude,
        });

        if (!intent) {
          throw new NotFoundException('Payment intent not found');
        }

        return {
          verified: false,
          intent,
          payment: paymentRecord,
          invoice: invoiceRecord,
          paymentCreated,
          requiresManualReview,
        };
      }

      await this.appendPaymentIntentEventTx(tx, {
        paymentIntentId: currentIntent.id,
        paymentAttemptId: currentAttempt.id,
        type: PaymentIntentEventType.VERIFICATION_PASSED,
        source,
        provider,
        payload: {
          providerTransactionId: signal.providerTransactionId ?? null,
        },
      });

      if (!this.isIntentTerminal(currentIntent.status)) {
        let nextIntentStatus = this.mapSignalToIntentStatus(signal.status);
        let nextAttemptStatus = this.mapSignalToAttemptStatus(signal.status);

        if (nextIntentStatus === PaymentIntentStatus.SUCCEEDED) {
          if (!paymentRecord) {
            const freshInvoice = await tx.invoice.findUnique({
              where: { id: currentIntent.invoiceId },
              include: {
                payments: true,
              },
            });

            if (!freshInvoice) {
              throw new NotFoundException('Invoice not found');
            }

            const outstandingAmount = this.calculateOutstandingAmount(
              Number(freshInvoice.total),
              freshInvoice.payments,
            );

            if (outstandingAmount <= 0) {
              nextIntentStatus = PaymentIntentStatus.FAILED;
              nextAttemptStatus = PaymentAttemptStatus.FAILED;
              requiresManualReview = true;
            } else {
              const paymentNumber = await this.generatePaymentNumberTx(tx);

              paymentRecord = await tx.payment.create({
                data: {
                  paymentNumber,
                  invoiceId: freshInvoice.id,
                  studentId: freshInvoice.studentId,
                  amount: Number(currentIntent.amount),
                  method: provider,
                  status: PaymentStatus.COMPLETED,
                  paidAt: occurredAt,
                  transactionId: signal.providerTransactionId,
                  notes: `Captured via ${provider} sandbox ${source.toLowerCase()}`,
                  paymentIntentId: currentIntent.id,
                },
              });

              paymentCreated = true;

              invoiceRecord = await tx.invoice.update({
                where: { id: freshInvoice.id },
                data: {
                  status: this.resolveInvoiceStatusFromPayments(
                    Number(freshInvoice.total),
                    [...freshInvoice.payments, paymentRecord],
                  ),
                  paidAt:
                    this.resolveInvoiceStatusFromPayments(
                      Number(freshInvoice.total),
                      [...freshInvoice.payments, paymentRecord],
                    ) === InvoiceStatus.PAID
                      ? occurredAt
                      : freshInvoice.paidAt,
                },
              });

              await this.appendPaymentIntentEventTx(tx, {
                paymentIntentId: currentIntent.id,
                paymentAttemptId: currentAttempt.id,
                type: PaymentIntentEventType.PAYMENT_RECORDED,
                source,
                provider,
                payload: {
                  paymentId: paymentRecord.id,
                  paymentNumber: paymentRecord.paymentNumber,
                  invoiceStatus: invoiceRecord.status,
                },
              });
            }
          }
        }

        if (requiresManualReview) {
          await this.appendPaymentIntentEventTx(tx, {
            paymentIntentId: currentIntent.id,
            paymentAttemptId: currentAttempt.id,
            type: PaymentIntentEventType.MANUAL_REVIEW_REQUIRED,
            source,
            provider,
            payload: {
              reason: 'invoice-already-settled-before-fulfillment',
            },
          });
        }

        if (nextIntentStatus !== currentIntent.status) {
          await tx.paymentIntent.update({
            where: { id: currentIntent.id },
            data: {
              status: nextIntentStatus,
              lastSignalAt: occurredAt,
              ...(this.isIntentTerminal(nextIntentStatus)
                ? { finalizedAt: occurredAt }
                : {}),
            },
          });
        } else {
          await tx.paymentIntent.update({
            where: { id: currentIntent.id },
            data: {
              lastSignalAt: occurredAt,
            },
          });
        }

        if (nextAttemptStatus !== currentAttempt.status) {
          await tx.paymentAttempt.update({
            where: { id: currentAttempt.id },
            data: {
              status: nextAttemptStatus,
              occurredAt,
              ...(signal.providerTransactionId
                ? { providerReference: signal.providerTransactionId }
                : {}),
              ...(this.isAttemptTerminal(nextAttemptStatus)
                ? { finalizedAt: occurredAt }
                : {}),
            },
          });
        }

        if (
          nextIntentStatus !== currentIntent.status ||
          nextAttemptStatus !== currentAttempt.status
        ) {
          await this.appendPaymentIntentEventTx(tx, {
            paymentIntentId: currentIntent.id,
            paymentAttemptId: currentAttempt.id,
            type: PaymentIntentEventType.STATE_TRANSITION,
            source,
            provider,
            fromIntentStatus: currentIntent.status,
            toIntentStatus: nextIntentStatus,
            fromAttemptStatus: currentAttempt.status,
            toAttemptStatus: nextAttemptStatus,
            payload: {
              occurredAt: occurredAt.toISOString(),
            },
          });
        }
      } else {
        await tx.paymentIntent.update({
          where: { id: currentIntent.id },
          data: {
            lastSignalAt: occurredAt,
          },
        });
      }

      const intent = await tx.paymentIntent.findUnique({
        where: { id: currentIntent.id },
        include: paymentIntentDetailInclude,
      });

      if (!intent) {
        throw new NotFoundException('Payment intent not found');
      }

      return {
        verified: true,
        intent,
        payment: paymentRecord,
        invoice: invoiceRecord,
        paymentCreated,
        requiresManualReview,
      };
    });

    if (result.paymentCreated && result.payment) {
      if (result.invoice.studentEmail) {
        this.emailService
          .sendPaymentConfirmation(
            result.invoice.studentEmail,
            result.invoice.studentDisplayName,
            result.invoice.invoiceNumber,
            Number(result.payment.amount),
          )
          .catch((error) => {
            this.logger.error(
              'Failed to send payment confirmation email',
              error,
            );
          });
      }

      await this.publishPaymentCompleted(result.invoice, result.payment);
    }

    return {
      acknowledged: true,
      verified: result.verified,
      provider,
      intentId: result.intent.id,
      intentNumber: result.intent.intentNumber,
      intentStatus: result.intent.status,
      attemptStatus:
        result.intent.attempts.find((attempt) => attempt.publicToken === token)
          ?.status ?? null,
      paymentId: result.payment?.id ?? null,
      requiresManualReview: result.requiresManualReview,
    };
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

    const semesterSnapshot = this.resolveSemesterSnapshot(semester);
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
        semesterName: semesterSnapshot.name,
        semesterNameEn: semesterSnapshot.nameEn,
        semesterNameVi: semesterSnapshot.nameVi,
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
    const semesterSnapshot = this.resolveInvoiceSemesterSnapshot(invoice);
    const status = this.resolveDisplayInvoiceStatus(
      Number(invoice.total),
      invoice.dueDate,
      invoice.status,
      invoice.payments,
    );

    return {
      ...invoice,
      semesterNameEn: semesterSnapshot.nameEn,
      semesterNameVi: semesterSnapshot.nameVi,
      status,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      paidAt: this.resolveDisplayPaidAt(
        invoice.paidAt,
        invoice.payments,
        status,
      ),
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
        name: semesterSnapshot.name,
        nameEn: semesterSnapshot.nameEn,
        nameVi: semesterSnapshot.nameVi,
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

  private toPaymentIntentResponse(
    intent: PaymentIntentDetail,
    selectedAttempt?: PaymentIntentDetail['attempts'][number],
  ) {
    const latestAttempt = selectedAttempt ?? intent.attempts[0];
    const outstandingAmount = this.calculateOutstandingAmount(
      Number(intent.invoice.total),
      intent.invoice.payments,
    );

    return {
      id: intent.id,
      intentNumber: intent.intentNumber,
      invoiceId: intent.invoiceId,
      invoiceNumber: intent.invoice.invoiceNumber,
      provider: intent.provider,
      status: intent.status,
      amount: Number(intent.amount),
      currency: intent.currency,
      outstandingAmount,
      expiresAt: intent.expiresAt,
      finalizedAt: intent.finalizedAt,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      paymentId: intent.payment?.id ?? null,
      nextAction: latestAttempt
        ? this.resolveAttemptNextAction(latestAttempt)
        : null,
      latestAttempt: latestAttempt
        ? this.toPaymentAttemptView(latestAttempt)
        : null,
      attempts: intent.attempts.map((attempt) =>
        this.toPaymentAttemptView(attempt),
      ),
      timeline: intent.events.map((event) => ({
        id: event.id,
        type: event.type,
        source: event.source,
        provider: event.provider,
        fromIntentStatus: event.fromIntentStatus,
        toIntentStatus: event.toIntentStatus,
        fromAttemptStatus: event.fromAttemptStatus,
        toAttemptStatus: event.toAttemptStatus,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
      sandbox: latestAttempt
        ? {
            mode: 'SANDBOX',
            callbackUrl: latestAttempt.callbackUrl,
            webhookUrl: latestAttempt.webhookUrl,
            publicToken: latestAttempt.publicToken,
            signatureAlgorithm: 'HMAC-SHA256',
            signatureFields: [
              'provider',
              'attemptToken',
              'status',
              'providerTransactionId',
            ],
            supportedStatuses: Object.values(SandboxPaymentSignalStatus),
          }
        : null,
    };
  }

  private toPaymentAttemptView(
    attempt: PaymentIntentDetail['attempts'][number],
  ) {
    const nextAction = this.resolveAttemptNextAction(attempt);

    return {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      provider: attempt.provider,
      status: attempt.status,
      amount: Number(attempt.amount),
      currency: attempt.currency,
      publicToken: attempt.publicToken,
      providerReference: attempt.providerReference,
      callbackUrl: attempt.callbackUrl,
      webhookUrl: attempt.webhookUrl,
      returnUrl: attempt.returnUrl,
      cancelUrl: attempt.cancelUrl,
      nextAction,
      occurredAt: attempt.occurredAt,
      finalizedAt: attempt.finalizedAt,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    };
  }

  private async findSandboxAttempt(providerValue: string, token: string) {
    const provider = parsePaymentProvider(providerValue);
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        provider,
        publicToken: token,
      },
      include: paymentAttemptWithIntentInclude,
    });

    if (!attempt) {
      throw new NotFoundException('Payment attempt not found');
    }

    const intent = attempt.intent;
    if (this.shouldExpireIntent(intent)) {
      await this.expirePaymentIntent(
        intent,
        'intent-expired-on-provider-handoff',
      );
      const refreshedAttempt = await this.prisma.paymentAttempt.findFirst({
        where: {
          provider,
          publicToken: token,
        },
        include: paymentAttemptWithIntentInclude,
      });

      if (!refreshedAttempt) {
        throw new NotFoundException('Payment attempt not found');
      }

      return {
        attempt: refreshedAttempt,
        intent: refreshedAttempt.intent,
      };
    }

    return { attempt, intent };
  }

  private resolveAttemptNextAction(attempt: {
    provider: PaymentProvider;
    publicToken: string;
    providerPayload: Prisma.JsonValue | null;
  }) {
    const payload = this.asRecord(attempt.providerPayload);

    const nextAction = this.asRecord(payload?.nextAction);
    if (nextAction) {
      return {
        flow: String(nextAction.flow),
        redirectUrl: this.asOptionalString(nextAction.redirectUrl),
        approvalUrl: this.asOptionalString(nextAction.approvalUrl),
        hostedCheckoutUrl: this.asOptionalString(nextAction.hostedCheckoutUrl),
        deeplinkUrl: this.asOptionalString(nextAction.deeplinkUrl),
        qrPayload: this.asOptionalString(nextAction.qrPayload),
        qrCodeUrl: this.asOptionalString(nextAction.qrCodeUrl),
      };
    }

    const handoffUrl = this.asOptionalString(payload?.handoffUrl);
    if (!handoffUrl) {
      return null;
    }

    return buildSandboxProviderNextAction({
      provider: attempt.provider,
      handoffUrl,
      publicToken: attempt.publicToken,
    });
  }

  private buildCheckoutReturnUrl(
    providedTarget: string | null | undefined,
    invoiceId: string,
    intentId: string,
    provider: PaymentProvider,
    status: SandboxPaymentSignalStatus,
  ) {
    const locale = this.resolveCheckoutLocale(providedTarget);
    const fallbackPath =
      locale === 'vi' ? '/vi/dashboard/invoices' : '/en/dashboard/invoices';
    const target = new URL(
      providedTarget || fallbackPath,
      this.configService.get<string>(ENV.FRONTEND_URL, 'http://localhost'),
    );

    target.searchParams.set('invoice', invoiceId);
    target.searchParams.set('intent', intentId);
    target.searchParams.set('provider', getPaymentProviderSegment(provider));
    target.searchParams.set('paymentStatus', status.toLowerCase());

    return target.toString();
  }

  private resolveCheckoutLocale(...targets: Array<string | null | undefined>) {
    for (const target of targets) {
      if (!target) {
        continue;
      }

      try {
        const pathname = new URL(
          target,
          this.configService.get<string>(ENV.FRONTEND_URL, 'http://localhost'),
        ).pathname;

        if (pathname === '/vi' || pathname.startsWith('/vi/')) {
          return 'vi';
        }
      } catch {
        continue;
      }
    }

    return 'en';
  }

  private getProviderLabels(provider: PaymentProvider) {
    switch (provider) {
      case PaymentProvider.MOMO:
        return { en: 'MoMo', vi: 'MoMo' };
      case PaymentProvider.ZALOPAY:
        return { en: 'ZaloPay', vi: 'ZaloPay' };
      case PaymentProvider.VNPAY:
        return { en: 'VNPay', vi: 'VNPay' };
      case PaymentProvider.PAYPAL:
        return { en: 'PayPal', vi: 'PayPal' };
      case PaymentProvider.CARD:
        return {
          en: 'Hosted card checkout',
          vi: 'Thanh toán thẻ bảo mật',
        };
      default:
        return { en: provider, vi: provider };
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private asOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private calculatePaidAmount(
    payments: Array<{ amount: Prisma.Decimal | number; status: PaymentStatus }>,
  ) {
    return payments
      .filter((payment) => payment.status === PaymentStatus.COMPLETED)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
  }

  private resolveSemesterSnapshot(
    semester: FinanceContextSemester,
  ): InvoiceSemesterSnapshot {
    return {
      name: semester.name,
      nameEn: semester.nameEn ?? semester.name,
      nameVi: semester.nameVi ?? null,
    };
  }

  private resolveInvoiceSemesterSnapshot(
    invoice: Pick<
      Invoice,
      'semesterName' | 'semesterNameEn' | 'semesterNameVi'
    >,
  ): InvoiceSemesterSnapshot {
    return {
      name: invoice.semesterName,
      nameEn: invoice.semesterNameEn ?? invoice.semesterName,
      nameVi: invoice.semesterNameVi ?? null,
    };
  }

  private calculateOutstandingAmount(
    invoiceTotal: number,
    payments: Array<{ amount: Prisma.Decimal | number; status: PaymentStatus }>,
  ) {
    return Math.max(invoiceTotal - this.calculatePaidAmount(payments), 0);
  }

  private resolveInvoiceStatusFromPayments(
    invoiceTotal: number,
    payments: Array<{ amount: Prisma.Decimal | number; status: PaymentStatus }>,
  ) {
    const paidAmount = this.calculatePaidAmount(payments);

    if (paidAmount >= invoiceTotal) {
      return InvoiceStatus.PAID;
    }

    if (paidAmount > 0) {
      return InvoiceStatus.PARTIALLY_PAID;
    }

    return InvoiceStatus.PENDING;
  }

  private resolveDisplayInvoiceStatus(
    invoiceTotal: number,
    dueDate: Date,
    currentStatus: InvoiceStatus,
    payments: Array<{ amount: Prisma.Decimal | number; status: PaymentStatus }>,
  ) {
    if (currentStatus === InvoiceStatus.CANCELLED) {
      return InvoiceStatus.CANCELLED;
    }

    const paidStatus = this.resolveInvoiceStatusFromPayments(
      invoiceTotal,
      payments,
    );

    if (
      currentStatus === InvoiceStatus.DRAFT &&
      paidStatus === InvoiceStatus.PENDING
    ) {
      return InvoiceStatus.DRAFT;
    }

    if (
      paidStatus === InvoiceStatus.PENDING &&
      dueDate.getTime() < Date.now()
    ) {
      return InvoiceStatus.OVERDUE;
    }

    return paidStatus;
  }

  private resolveDisplayPaidAt(
    paidAt: Date | null,
    payments: Array<{
      amount: Prisma.Decimal | number;
      status: PaymentStatus;
      paidAt?: Date | null;
    }>,
    status: InvoiceStatus,
  ) {
    if (status !== InvoiceStatus.PAID) {
      return null;
    }

    const latestCompletedPayment = payments
      .filter(
        (payment): payment is typeof payment & { paidAt: Date } =>
          payment.status === PaymentStatus.COMPLETED &&
          payment.paidAt instanceof Date,
      )
      .sort((left, right) => right.paidAt.getTime() - left.paidAt.getTime())[0];

    return latestCompletedPayment?.paidAt ?? paidAt;
  }

  private shouldExpireIntent(intent: PaymentIntentDetail) {
    return (
      !this.isIntentTerminal(intent.status) &&
      intent.expiresAt.getTime() <= Date.now()
    );
  }

  private isIntentTerminal(status: PaymentIntentStatus) {
    return TERMINAL_INTENT_STATUSES.includes(status);
  }

  private isAttemptTerminal(status: PaymentAttemptStatus) {
    return TERMINAL_ATTEMPT_STATUSES.includes(status);
  }

  private async expirePaymentIntent(
    intent: PaymentIntentDetail,
    reason: string,
  ) {
    if (!this.shouldExpireIntent(intent)) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentIntent.findUnique({
        where: { id: intent.id },
        include: paymentIntentDetailInclude,
      });

      if (!current || !this.shouldExpireIntent(current)) {
        return;
      }

      const now = new Date();

      await tx.paymentIntent.update({
        where: { id: current.id },
        data: {
          status: PaymentIntentStatus.EXPIRED,
          finalizedAt: now,
          lastSignalAt: now,
        },
      });

      await tx.paymentAttempt.updateMany({
        where: {
          intentId: current.id,
          status: {
            in: ACTIVE_ATTEMPT_STATUSES,
          },
        },
        data: {
          status: PaymentAttemptStatus.EXPIRED,
          finalizedAt: now,
        },
      });

      const activeAttempt = current.attempts.find(
        (attempt) => !this.isAttemptTerminal(attempt.status),
      );

      await this.appendPaymentIntentEventTx(tx, {
        paymentIntentId: current.id,
        paymentAttemptId: activeAttempt?.id,
        type: PaymentIntentEventType.STATE_TRANSITION,
        source: PaymentSignalSource.SYSTEM,
        provider: current.provider,
        fromIntentStatus: current.status,
        toIntentStatus: PaymentIntentStatus.EXPIRED,
        fromAttemptStatus: activeAttempt?.status,
        toAttemptStatus: activeAttempt
          ? PaymentAttemptStatus.EXPIRED
          : undefined,
        payload: {
          reason,
        },
      });
    });
  }

  private mapSignalToIntentStatus(status: SandboxPaymentSignalStatus) {
    switch (status) {
      case SandboxPaymentSignalStatus.SUCCESS:
        return PaymentIntentStatus.SUCCEEDED;
      case SandboxPaymentSignalStatus.FAILED:
        return PaymentIntentStatus.FAILED;
      case SandboxPaymentSignalStatus.CANCELLED:
        return PaymentIntentStatus.CANCELLED;
      case SandboxPaymentSignalStatus.PROCESSING:
        return PaymentIntentStatus.PROCESSING;
      default:
        return PaymentIntentStatus.PROCESSING;
    }
  }

  private mapSignalToAttemptStatus(status: SandboxPaymentSignalStatus) {
    switch (status) {
      case SandboxPaymentSignalStatus.SUCCESS:
        return PaymentAttemptStatus.SUCCEEDED;
      case SandboxPaymentSignalStatus.FAILED:
        return PaymentAttemptStatus.FAILED;
      case SandboxPaymentSignalStatus.CANCELLED:
        return PaymentAttemptStatus.CANCELLED;
      case SandboxPaymentSignalStatus.PROCESSING:
        return PaymentAttemptStatus.PROCESSING;
      default:
        return PaymentAttemptStatus.PROCESSING;
    }
  }

  private verifySandboxSignal(
    provider: PaymentProvider,
    token: string,
    signal: ProviderSignalDto,
  ) {
    return verifySandboxPaymentSignal(
      this.getSandboxSharedSecret(),
      signal.signature,
      {
        provider,
        attemptToken: token,
        status: signal.status,
        providerTransactionId: signal.providerTransactionId,
      },
    );
  }

  private getSandboxSharedSecret() {
    return (
      this.configService.get<string>(ENV.PAYMENT_SANDBOX_SHARED_SECRET) ??
      this.configService.get<string>(ENV.INTERNAL_SERVICE_TOKEN) ??
      'finance-service-sandbox-secret'
    );
  }

  private toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async appendPaymentIntentEventTx(
    tx: Prisma.TransactionClient,
    data: {
      paymentIntentId: string;
      paymentAttemptId?: string;
      type: PaymentIntentEventType;
      source: PaymentSignalSource;
      provider: PaymentProvider;
      fromIntentStatus?: PaymentIntentStatus;
      toIntentStatus?: PaymentIntentStatus;
      fromAttemptStatus?: PaymentAttemptStatus;
      toAttemptStatus?: PaymentAttemptStatus;
      payload?: Record<string, unknown>;
    },
  ) {
    await tx.paymentIntentEvent.create({
      data: {
        paymentIntentId: data.paymentIntentId,
        paymentAttemptId: data.paymentAttemptId,
        type: data.type,
        source: data.source,
        provider: data.provider,
        fromIntentStatus: data.fromIntentStatus,
        toIntentStatus: data.toIntentStatus,
        fromAttemptStatus: data.fromAttemptStatus,
        toAttemptStatus: data.toAttemptStatus,
        payload: data.payload ? this.toJsonValue(data.payload) : undefined,
      },
    });
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

  private async generatePaymentNumberTx(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const count = await tx.payment.count();
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
        semesterNameEn: string;
        semesterNameVi: string | null;
      };
    }> = {
      type: FINANCE_EVENT_TYPES.INVOICE_CREATED,
      source: 'campuscore-finance-service',
      occurredAt: new Date().toISOString(),
      payload: {
        userId: invoice.studentUserId,
        notification: {
          title: `Invoice ${invoice.invoiceNumber} created`,
          message: `A new invoice for ${invoice.semesterNameEn ?? invoice.semesterName} is now available in your billing dashboard.`,
          type: 'INFO',
          link: '/dashboard/invoices',
        },
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          total: Number(invoice.total),
          dueDate: invoice.dueDate.toISOString(),
          semesterName: invoice.semesterName,
          semesterNameEn: invoice.semesterNameEn ?? invoice.semesterName,
          semesterNameVi: invoice.semesterNameVi ?? null,
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
