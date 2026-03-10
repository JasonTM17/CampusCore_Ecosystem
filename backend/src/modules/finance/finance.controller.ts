import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Finance')
@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Post('invoices')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create invoice' })
  createInvoice(@Body() data: any) {
    return this.financeService.createInvoice(data);
  }

  @Get('invoices')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all invoices' })
  findAllInvoices(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.financeService.findAllInvoices(page || 1, limit || 20);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  findOneInvoice(@Param('id') id: string) {
    return this.financeService.findOneInvoice(id);
  }

  @Put('invoices/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update invoice' })
  updateInvoice(@Param('id') id: string, @Body() data: any) {
    return this.financeService.updateInvoice(id, data);
  }

  @Delete('invoices/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete invoice' })
  removeInvoice(@Param('id') id: string) {
    return this.financeService.removeInvoice(id);
  }

  @Post('payments')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create payment' })
  createPayment(@Body() data: any) {
    return this.financeService.createPayment(data);
  }

  @Get('payments')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all payments' })
  findAllPayments(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.financeService.findAllPayments(page || 1, limit || 20);
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Get payment by ID' })
  findOnePayment(@Param('id') id: string) {
    return this.financeService.findOnePayment(id);
  }

  @Put('payments/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update payment' })
  updatePayment(@Param('id') id: string, @Body() data: any) {
    return this.financeService.updatePayment(id, data);
  }

  @Delete('payments/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete payment' })
  removePayment(@Param('id') id: string) {
    return this.financeService.removePayment(id);
  }
}
