import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Finance')
@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  // ============ STUDENT INVOICE ENDPOINTS ============

  @Get('my/invoices')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Get current student invoices' })
  getMyInvoices(
    @CurrentUser('studentId') studentId: string,
    @Query('semesterId') semesterId?: string
  ) {
    if (!studentId) {
      throw new Error('Student profile not found');
    }
    return this.financeService.getStudentInvoices(studentId, semesterId);
  }

  @Get('my/invoices/:id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Get current student invoice by ID' })
  getMyInvoiceById(
    @CurrentUser('studentId') studentId: string,
    @Param('id') id: string
  ) {
    if (!studentId) {
      throw new Error('Student profile not found');
    }
    return this.financeService.getStudentInvoiceById(studentId, id);
  }

  @Post('my/payments')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Record payment for current student invoice' })
  createMyPayment(
    @CurrentUser('studentId') studentId: string,
    @Body() data: { invoiceId: string; amount: number; method: string; transactionId?: string }
  ) {
    if (!studentId) {
      throw new Error('Student profile not found');
    }
    return this.financeService.createPayment({
      ...data,
      studentId,
    });
  }

  // ============ ADMIN INVOICE ENDPOINTS ============

  @Post('invoices')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create invoice (admin only)' })
  createInvoice(@Body() data: any) {
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
    @Query('studentId') studentId?: string
  ) {
    return this.financeService.findAllInvoices(page || 1, limit || 20, status, semesterId, studentId);
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
  updateInvoice(@Param('id') id: string, @Body() data: any) {
    return this.financeService.updateInvoice(id, data);
  }

  @Delete('invoices/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete invoice (admin only)' })
  removeInvoice(@Param('id') id: string) {
    return this.financeService.removeInvoice(id);
  }

  // ============ INVOICE GENERATION ============

  @Post('invoices/generate/student/:studentId/semester/:semesterId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Generate invoice for a student in a semester (admin only)' })
  generateStudentInvoice(
    @Param('studentId') studentId: string,
    @Param('semesterId') semesterId: string
  ) {
    return this.financeService.generateInvoiceForStudentSemester(studentId, semesterId);
  }

  @Post('invoices/generate/semester/:semesterId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Generate invoices for all students in a semester (admin only)' })
  generateSemesterInvoices(@Param('semesterId') semesterId: string) {
    return this.financeService.generateInvoicesForSemester(semesterId);
  }

  // ============ ADMIN PAYMENT ENDPOINTS ============

  @Post('payments')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create payment (admin only)' })
  createPayment(@Body() data: any) {
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
    @Query('studentId') studentId?: string
  ) {
    return this.financeService.findAllPayments(page || 1, limit || 20, status, invoiceId, studentId);
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
  updatePayment(@Param('id') id: string, @Body() data: any) {
    return this.financeService.updatePayment(id, data);
  }

  @Delete('payments/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete payment (admin only)' })
  removePayment(@Param('id') id: string) {
    return this.financeService.removePayment(id);
  }
}
