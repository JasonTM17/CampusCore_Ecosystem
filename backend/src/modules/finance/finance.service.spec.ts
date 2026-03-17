import { Test, TestingModule } from '@nestjs/testing';
import { FinanceService } from './finance.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CsvExportService } from '../common/services/csv-export.service';
import { NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';

describe('FinanceService', () => {
  let service: FinanceService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrisma = {
    invoice: {
      findUnique: jest.fn(),
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
      aggregate: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
    semester: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    enrollment: {
      findMany: jest.fn(),
    },
  };

  const mockCsvExportService = {
    exportToCsv: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: CsvExportService,
          useValue: mockCsvExportService,
        },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
    prismaService = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('createInvoice', () => {
    it('should create an invoice with calculated totals', async () => {
      const invoiceData = {
        studentId: 'student-uuid',
        semesterId: 'semester-uuid',
        dueDate: new Date(),
        items: [
          { description: 'Course 1', quantity: 1, unitPrice: 500000 },
          { description: 'Course 2', quantity: 2, unitPrice: 300000 },
        ],
      };

      mockPrisma.invoice.create.mockResolvedValue({
        id: 'invoice-uuid',
        invoiceNumber: 'INV-0001',
        ...invoiceData,
        subtotal: 1100000,
        discount: 0,
        total: 1100000,
        status: InvoiceStatus.DRAFT,
      } as any);

      const result = await service.createInvoice(invoiceData);

      expect(result.total).toBe(1100000);
      expect(mockPrisma.invoice.create).toHaveBeenCalled();
    });
  });

  describe('findAllInvoices', () => {
    it('should return paginated invoices', async () => {
      const mockInvoices = [
        { id: '1', invoiceNumber: 'INV-001', status: InvoiceStatus.PAID },
        { id: '2', invoiceNumber: 'INV-002', status: InvoiceStatus.PENDING },
      ];
      mockPrisma.invoice.findMany.mockResolvedValue(mockInvoices as any);
      mockPrisma.invoice.count.mockResolvedValue(2);

      const result = await service.findAllInvoices(1, 20);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result.meta.total).toBe(2);
    });

    it('should filter invoices by status', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.findAllInvoices(1, 20, 'PAID');

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });
  });

  describe('findOneInvoice', () => {
    it('should return an invoice by id', async () => {
      const invoiceId = 'invoice-uuid';
      const mockInvoice = { id: invoiceId, invoiceNumber: 'INV-001' };
      mockPrisma.invoice.findUnique.mockResolvedValue(mockInvoice as any);

      const result = await service.findOneInvoice(invoiceId);

      expect(result).toEqual(mockInvoice);
    });

    it('should throw NotFoundException if invoice not found', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(null);

      await expect(service.findOneInvoice('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateInvoiceStatus', () => {
    it('should update invoice status', async () => {
      const invoiceId = 'invoice-uuid';
      mockPrisma.invoice.findUnique.mockResolvedValue({ id: invoiceId } as any);
      mockPrisma.invoice.update.mockResolvedValue({
        id: invoiceId,
        status: InvoiceStatus.PAID,
      } as any);

      const result = await service.updateInvoice(invoiceId, { status: 'PAID' });

      expect(result.status).toBe('PAID');
    });
  });

  describe('findAllPayments', () => {
    it('should return paginated payments', async () => {
      const mockPayments = [
        { id: '1', paymentNumber: 'PAY-001', status: PaymentStatus.COMPLETED },
        { id: '2', paymentNumber: 'PAY-002', status: PaymentStatus.PENDING },
      ];
      mockPrisma.payment.findMany.mockResolvedValue(mockPayments as any);
      mockPrisma.payment.count.mockResolvedValue(2);

      const result = await service.findAllPayments(1, 20);

      expect(result.meta.total).toBe(2);
    });
  });

  describe('updatePayment', () => {
    it('should update payment status', async () => {
      const paymentId = 'payment-uuid';
      mockPrisma.payment.findUnique.mockResolvedValue({ id: paymentId } as any);
      mockPrisma.payment.update.mockResolvedValue({
        id: paymentId,
        status: PaymentStatus.COMPLETED,
      } as any);

      const result = await service.updatePayment(paymentId, { status: 'COMPLETED' });

      expect(result.status).toBe('COMPLETED');
    });
  });
});
