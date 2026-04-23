import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Res,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentStudent } from '../auth/decorators/current-user.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { CreateMyPaymentDto } from './dto/create-my-payment.dto';
import { InitiatePaymentIntentDto } from './dto/initiate-payment-intent.dto';
import { SimulateSandboxPaymentSignalDto } from './dto/simulate-sandbox-payment-signal.dto';

@ApiTags('Finance')
@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('my/invoices')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get current student invoices' })
  getMyInvoices(
    @CurrentStudent() studentId: string,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.financeService.getStudentInvoices(studentId, semesterId);
  }

  @Get('my/invoices/:id')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get current student invoice by ID' })
  getMyInvoiceById(
    @CurrentStudent() studentId: string,
    @Param('id') id: string,
  ) {
    return this.financeService.getStudentInvoiceById(studentId, id);
  }

  @Post('my/invoices/:id/checkout')
  @Roles('STUDENT')
  @ApiOperation({
    summary:
      'Initiate a sandbox payment checkout intent for the current student',
  })
  initiateCheckout(
    @CurrentStudent() studentId: string,
    @Param('id') invoiceId: string,
    @Body() data: InitiatePaymentIntentDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    if (!studentId) {
      throw new ForbiddenException('Student profile not found');
    }

    return this.financeService.initiateStudentInvoiceCheckout(
      studentId,
      invoiceId,
      data,
      headerIdempotencyKey,
    );
  }

  @Get('my/payment-intents/:id')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get the current student payment intent by ID' })
  getMyPaymentIntent(
    @CurrentStudent() studentId: string,
    @Param('id') id: string,
  ) {
    if (!studentId) {
      throw new ForbiddenException('Student profile not found');
    }

    return this.financeService.getStudentPaymentIntent(studentId, id);
  }

  @Post('my/payment-intents/:id/sandbox-signal')
  @Roles('STUDENT')
  @ApiOperation({
    summary: 'Simulate a sandbox provider signal for the current student',
  })
  sendMySandboxPaymentSignal(
    @CurrentStudent() studentId: string,
    @Param('id') id: string,
    @Body() data: SimulateSandboxPaymentSignalDto,
  ) {
    if (!studentId) {
      throw new ForbiddenException('Student profile not found');
    }

    return this.financeService.signalStudentSandboxPaymentIntent(
      studentId,
      id,
      data,
    );
  }

  @Post('my/payments')
  @Roles('STUDENT')
  @ApiOperation({
    summary:
      'Legacy direct payment recording endpoint for current student invoice',
  })
  createMyPayment(
    @CurrentStudent() studentId: string,
    @Body() data: CreateMyPaymentDto,
  ) {
    if (!studentId) {
      throw new ForbiddenException('Student profile not found');
    }

    void data;

    throw new BadRequestException(
      'Student payments must be initiated through the checkout flow',
    );
  }

  @Post('invoices')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create invoice (admin only)' })
  createInvoice(@Body() data: CreateInvoiceDto) {
    return this.financeService.createInvoice(data);
  }

  @Get('invoices')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all invoices (admin only)' })
  findAllInvoices(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('semesterId') semesterId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.financeService.findAllInvoices(
      page || 1,
      limit || 20,
      status,
      semesterId,
      studentId,
    );
  }

  @Get('invoices/export/csv')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Export invoices as CSV' })
  async exportInvoicesCsv(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('semesterId') semesterId?: string,
    @Query('studentId') studentId?: string,
  ) {
    const csv = await this.financeService.exportInvoices(
      status,
      semesterId,
      studentId,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=invoices.csv');
    res.send(csv);
  }

  @Get('invoices/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get invoice by ID (admin only)' })
  findOneInvoice(@Param('id') id: string) {
    return this.financeService.findOneInvoice(id);
  }

  @Put('invoices/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update invoice (admin only)' })
  updateInvoice(@Param('id') id: string, @Body() data: UpdateInvoiceDto) {
    return this.financeService.updateInvoice(id, data);
  }

  @Delete('invoices/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete invoice (admin only)' })
  removeInvoice(@Param('id') id: string) {
    return this.financeService.removeInvoice(id);
  }

  @Post('invoices/generate/student/:studentId/semester/:semesterId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Generate invoice for a student in a semester (admin only)',
  })
  generateStudentInvoice(
    @Param('studentId') studentId: string,
    @Param('semesterId') semesterId: string,
  ) {
    return this.financeService.generateInvoiceForStudentSemester(
      studentId,
      semesterId,
    );
  }

  @Post('invoices/generate/semester/:semesterId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Generate invoices for all students in a semester (admin only)',
  })
  generateSemesterInvoices(@Param('semesterId') semesterId: string) {
    return this.financeService.generateInvoicesForSemester(semesterId);
  }

  @Post('payments')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create payment (admin only)' })
  createPayment(@Body() data: CreatePaymentDto) {
    return this.financeService.createPayment(data);
  }

  @Get('payments')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all payments (admin only)' })
  findAllPayments(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.financeService.findAllPayments(
      page || 1,
      limit || 20,
      status,
      invoiceId,
      studentId,
    );
  }

  @Get('payments/export/csv')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Export payments as CSV' })
  async exportPaymentsCsv(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('studentId') studentId?: string,
  ) {
    const csv = await this.financeService.exportPayments(
      status,
      invoiceId,
      studentId,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
    res.send(csv);
  }

  @Get('payments/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get payment by ID (admin only)' })
  findOnePayment(@Param('id') id: string) {
    return this.financeService.findOnePayment(id);
  }

  @Put('payments/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update payment (admin only)' })
  updatePayment(@Param('id') id: string, @Body() data: UpdatePaymentDto) {
    return this.financeService.updatePayment(id, data);
  }

  @Delete('payments/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete payment (admin only)' })
  removePayment(@Param('id') id: string) {
    return this.financeService.removePayment(id);
  }
}
