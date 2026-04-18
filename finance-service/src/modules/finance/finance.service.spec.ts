import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import { FinanceService } from './finance.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CsvExportService } from '../common/services/csv-export.service';
import { EmailService } from '../common/services/email.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { CoreFinanceContextService } from './core-finance-context.service';

describe('FinanceService', () => {
  let service: FinanceService;

  const mockPrisma = {
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
  };

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

  it('throws when invoice is missing', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    await expect(service.findOneInvoice('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
