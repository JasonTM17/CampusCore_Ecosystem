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

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create finance record' })
  create(@Body() data: any) {
    return this.financeService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all finance records' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.financeService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get finance record by ID' })
  findOne(@Param('id') id: string) {
    return this.financeService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update finance record' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.financeService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete finance record' })
  remove(@Param('id') id: string) {
    return this.financeService.remove(id);
  }
}
