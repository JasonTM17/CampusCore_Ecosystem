import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async createInvoice(data: any) {
    return this.prisma.invoice.create({ data, include: { student: true, semester: true } });
  }

  async findAllInvoices(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({ skip, take: limit, include: { student: true, semester: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.invoice.count(),
    ]);
    return { data: invoices, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { student: true, semester: true, items: true } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async updateInvoice(id: string, data: any) {
    await this.findOneInvoice(id);
    return this.prisma.invoice.update({ where: { id }, data });
  }

  async removeInvoice(id: string) {
    await this.findOneInvoice(id);
    await this.prisma.invoice.delete({ where: { id } });
    return { message: 'Invoice deleted successfully' };
  }

  async createPayment(data: any) {
    return this.prisma.payment.create({ data, include: { invoice: true, student: true } });
  }

  async findAllPayments(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({ skip, take: limit, include: { invoice: true, student: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.payment.count(),
    ]);
    return { data: payments, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOnePayment(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: { invoice: true, student: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async updatePayment(id: string, data: any) {
    await this.findOnePayment(id);
    return this.prisma.payment.update({ where: { id }, data });
  }

  async removePayment(id: string) {
    await this.findOnePayment(id);
    await this.prisma.payment.delete({ where: { id } });
    return { message: 'Payment deleted successfully' };
  }
}
