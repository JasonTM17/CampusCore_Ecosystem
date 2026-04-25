import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvoiceStatus,
  PaymentAttemptStatus,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentStatus,
} from '@prisma/client';
import { FinanceService } from './finance.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CsvExportService } from '../common/services/csv-export.service';
import { EmailService } from '../common/services/email.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { CoreFinanceContextService } from './core-finance-context.service';

describe('FinanceService', () => {
  let service: FinanceService;

  const mockPrisma: any = {
    invoice: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    payment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    paymentIntent: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    paymentAttempt: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    paymentIntentEvent: {
      create: jest.fn(),
    },
  };
  mockPrisma.$transaction = jest.fn(
    async (callback: (prisma: typeof mockPrisma) => unknown) =>
      callback(mockPrisma),
  );

  const mockCsvExportService = {
    generateCsv: jest.fn().mockResolvedValue('csv'),
  };

  const mockEmailService = {
    sendPaymentConfirmation: jest.fn().mockResolvedValue(true),
  };

  const mockRabbitMqService = {
    publishMessage: jest.fn().mockResolvedValue(true),
  };

  const mockCoreContextService = {
    getStudent: jest.fn(),
    getSemester: jest.fn(),
    getBillableStudents: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'PAYMENT_SANDBOX_SHARED_SECRET') {
        return 'sandbox-secret';
      }

      if (key === 'INTERNAL_SERVICE_TOKEN') {
        return 'internal-service-token-12345';
      }

      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CsvExportService, useValue: mockCsvExportService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: RabbitMQService, useValue: mockRabbitMqService },
        {
          provide: CoreFinanceContextService,
          useValue: mockCoreContextService,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(FinanceService);
    jest.clearAllMocks();
  });

  it('creates an invoice with context snapshots and publishes an event', async () => {
    mockCoreContextService.getStudent.mockResolvedValue({
      id: 'student-1',
      userId: 'user-1',
      studentCode: 'STU001',
      displayName: 'Student One',
      email: 'student1@campuscore.edu',
    });
    mockCoreContextService.getSemester.mockResolvedValue({
      id: 'semester-1',
      name: 'Fall 2026',
      nameEn: 'Fall 2026',
      nameVi: 'Học kỳ Thu 2026',
      endDate: '2026-12-20T00:00:00.000Z',
    });
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.invoice.create.mockResolvedValue({
      id: 'invoice-1',
      invoiceNumber: 'INV-2026-00001',
      studentId: 'student-1',
      studentUserId: 'user-1',
      studentDisplayName: 'Student One',
      studentEmail: 'student1@campuscore.edu',
      studentCode: 'STU001',
      semesterId: 'semester-1',
      semesterName: 'Fall 2026',
      semesterNameEn: 'Fall 2026',
      semesterNameVi: 'Học kỳ Thu 2026',
      status: InvoiceStatus.DRAFT,
      subtotal: 450,
      discount: 0,
      total: 450,
      dueDate: new Date('2026-12-20T00:00:00.000Z'),
      paidAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      payments: [],
    });

    const result = await service.createInvoice({
      studentId: 'student-1',
      semesterId: 'semester-1',
      dueDate: new Date('2026-12-20T00:00:00.000Z'),
      items: [{ description: 'Tuition', quantity: 3, unitPrice: 150 }],
    });

    expect(result.invoiceNumber).toBe('INV-2026-00001');
    expect(result.semester.nameEn).toBe('Fall 2026');
    expect(result.semester.nameVi).toBe('Học kỳ Thu 2026');
    expect(mockPrisma.invoice.create).toHaveBeenCalled();
    expect(mockRabbitMqService.publishMessage).toHaveBeenCalled();
  });

  it('rejects overpayments', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      studentId: 'student-1',
      studentUserId: 'user-1',
      invoiceNumber: 'INV-1',
      studentDisplayName: 'Student One',
      studentEmail: 'student1@campuscore.edu',
      studentCode: 'STU001',
      semesterId: 'semester-1',
      semesterName: 'Fall 2026',
      semesterNameEn: 'Fall 2026',
      semesterNameVi: 'Học kỳ Thu 2026',
      status: InvoiceStatus.PENDING,
      subtotal: 500,
      discount: 0,
      total: 500,
      dueDate: new Date(),
      paidAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      payments: [
        {
          id: 'payment-1',
          amount: 450,
          status: PaymentStatus.COMPLETED,
        },
      ],
    });

    await expect(
      service.createPayment({
        invoiceId: 'invoice-1',
        studentId: 'student-1',
        amount: 100,
        method: 'CARD',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('normalizes stale paid invoice data when no completed payments exist', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'INV-1',
        studentId: 'student-1',
        studentUserId: 'user-1',
        studentDisplayName: 'Student One',
        studentEmail: 'student1@campuscore.edu',
        studentCode: 'STU001',
        semesterId: 'semester-1',
        semesterName: 'Fall 2026',
        semesterNameEn: 'Fall 2026',
        semesterNameVi: 'Học kỳ Thu 2026',
        status: InvoiceStatus.PAID,
        subtotal: 500,
        discount: 0,
        total: 500,
        dueDate: new Date(Date.now() + 86_400_000),
        paidAt: new Date(),
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: [],
      },
    ]);

    const [invoice] = await service.getStudentInvoices('student-1');

    expect(invoice.status).toBe(InvoiceStatus.PENDING);
    expect(invoice.paidAmount).toBe(0);
    expect(invoice.balance).toBe(500);
    expect(invoice.paidAt).toBeNull();
  });

  it('throws when invoice is missing', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    await expect(service.findOneInvoice('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reuses an existing attempt when checkout initiation is retried with the same idempotency key', async () => {
    mockPrisma.paymentAttempt.findFirst.mockResolvedValue({
      id: 'attempt-1',
      attemptNumber: 'PATT-20260422-EXAMPLE',
      intentId: 'intent-1',
      invoiceId: 'invoice-1',
      studentId: 'student-1',
      provider: PaymentProvider.MOMO,
      status: PaymentAttemptStatus.REDIRECT_REQUIRED,
      idempotencyKey: 'idem-checkout-001',
      publicToken: 'token-1',
      amount: 450,
      currency: 'VND',
      providerReference: null,
      redirectUrl: null,
      callbackUrl: '/api/v1/finance/payment-providers/momo/callback/token-1',
      webhookUrl: '/api/v1/finance/payment-providers/momo/webhook/token-1',
      returnUrl: 'http://localhost/return',
      cancelUrl: 'http://localhost/cancel',
      providerPayload: null,
      occurredAt: null,
      finalizedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      intent: {
        id: 'intent-1',
        intentNumber: 'PINT-20260422-EXAMPLE',
        invoiceId: 'invoice-1',
        studentId: 'student-1',
        provider: PaymentProvider.MOMO,
        status: PaymentIntentStatus.REQUIRES_ACTION,
        amount: 450,
        currency: 'VND',
        metadata: null,
        expiresAt: new Date(Date.now() + 60_000),
        lastSignalAt: null,
        finalizedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payment: null,
        invoice: {
          id: 'invoice-1',
          invoiceNumber: 'INV-1',
          studentId: 'student-1',
          studentUserId: 'user-1',
          studentDisplayName: 'Student One',
          studentEmail: 'student1@campuscore.edu',
          studentCode: 'STU001',
          semesterId: 'semester-1',
          semesterName: 'Fall 2026',
          semesterNameEn: 'Fall 2026',
          semesterNameVi: 'Học kỳ Thu 2026',
          status: InvoiceStatus.PENDING,
          subtotal: 450,
          discount: 0,
          total: 450,
          dueDate: new Date('2026-12-20T00:00:00.000Z'),
          paidAt: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          payments: [],
        },
        attempts: [],
        events: [],
      },
    });

    const result = await service.initiateStudentInvoiceCheckout(
      'student-1',
      'invoice-1',
      {
        provider: PaymentProvider.MOMO,
        idempotencyKey: 'idem-checkout-001',
        returnUrl: 'http://localhost/return',
        cancelUrl: 'http://localhost/cancel',
      },
      undefined,
    );

    expect(result.intentNumber).toBe('PINT-20260422-EXAMPLE');
    expect(mockPrisma.paymentIntent.create).not.toHaveBeenCalled();
    expect(mockPrisma.paymentAttempt.create).not.toHaveBeenCalled();
  });

  it('cancels a previous unfinished provider checkout when the student switches provider', async () => {
    const now = new Date();
    const invoice = {
      id: 'invoice-1',
      invoiceNumber: 'INV-1',
      studentId: 'student-1',
      studentUserId: 'user-1',
      studentDisplayName: 'Student One',
      studentEmail: 'student1@campuscore.edu',
      studentCode: 'STU001',
      semesterId: 'semester-1',
      semesterName: 'Fall 2026',
      semesterNameEn: 'Fall 2026',
      semesterNameVi: 'Hoc ky Thu 2026',
      status: InvoiceStatus.PENDING,
      subtotal: 450,
      discount: 0,
      total: 450,
      dueDate: new Date('2026-12-20T00:00:00.000Z'),
      paidAt: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      payments: [],
    };
    const activeAttempt = {
      id: 'attempt-momo',
      attemptNumber: 'PATT-20260422-MOMO',
      intentId: 'intent-momo',
      invoiceId: 'invoice-1',
      studentId: 'student-1',
      provider: PaymentProvider.MOMO,
      status: PaymentAttemptStatus.REDIRECT_REQUIRED,
      idempotencyKey: 'idem-momo-001',
      publicToken: 'token-momo',
      amount: 450,
      currency: 'VND',
      providerReference: null,
      redirectUrl: null,
      callbackUrl: '/api/v1/finance/payment-providers/momo/callback/token-momo',
      webhookUrl: '/api/v1/finance/payment-providers/momo/webhook/token-momo',
      returnUrl: 'http://localhost/return',
      cancelUrl: 'http://localhost/cancel',
      providerPayload: null,
      occurredAt: null,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const activeIntent = {
      id: 'intent-momo',
      intentNumber: 'PINT-20260422-MOMO',
      invoiceId: 'invoice-1',
      studentId: 'student-1',
      provider: PaymentProvider.MOMO,
      status: PaymentIntentStatus.REQUIRES_ACTION,
      amount: 450,
      currency: 'VND',
      metadata: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastSignalAt: null,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
      payment: null,
      invoice,
      attempts: [activeAttempt],
      events: [],
    };
    const createdIntent = {
      id: 'intent-zalopay',
      status: PaymentIntentStatus.REQUIRES_ACTION,
    };
    const createdAttempt = {
      ...activeAttempt,
      id: 'attempt-zalopay',
      attemptNumber: 'PATT-20260422-ZALOPAY',
      intentId: 'intent-zalopay',
      provider: PaymentProvider.ZALOPAY,
      status: PaymentAttemptStatus.REDIRECT_REQUIRED,
      idempotencyKey: 'idem-zalopay-001',
      publicToken: 'token-zalopay',
      callbackUrl:
        '/api/v1/finance/payment-providers/zalopay/callback/token-zalopay',
      webhookUrl:
        '/api/v1/finance/payment-providers/zalopay/webhook/token-zalopay',
    };
    const newIntent = {
      ...activeIntent,
      id: 'intent-zalopay',
      intentNumber: 'PINT-20260422-ZALOPAY',
      provider: PaymentProvider.ZALOPAY,
      attempts: [createdAttempt],
      events: [],
    };

    mockPrisma.paymentAttempt.findFirst.mockResolvedValue(null);
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
    mockPrisma.paymentIntent.findFirst.mockResolvedValue(activeIntent);
    mockPrisma.paymentIntent.findUnique
      .mockResolvedValueOnce(activeIntent)
      .mockResolvedValueOnce(newIntent);
    mockPrisma.paymentIntent.create.mockResolvedValue(createdIntent);
    mockPrisma.paymentAttempt.create.mockResolvedValue(createdAttempt);

    const result = await service.initiateStudentInvoiceCheckout(
      'student-1',
      'invoice-1',
      {
        provider: PaymentProvider.ZALOPAY,
        idempotencyKey: 'idem-zalopay-001',
        returnUrl: 'http://localhost/return',
        cancelUrl: 'http://localhost/cancel',
      },
      undefined,
    );

    expect(mockPrisma.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'intent-momo' },
        data: expect.objectContaining({
          status: PaymentIntentStatus.CANCELLED,
        }),
      }),
    );
    expect(mockPrisma.paymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ intentId: 'intent-momo' }),
        data: expect.objectContaining({
          status: PaymentAttemptStatus.CANCELLED,
        }),
      }),
    );
    expect(mockPrisma.paymentIntent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: PaymentProvider.ZALOPAY,
        }),
      }),
    );
    expect(result.provider).toBe(PaymentProvider.ZALOPAY);
  });
});
