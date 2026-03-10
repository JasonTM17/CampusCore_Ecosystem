import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SupportTicketsService } from './support-tickets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Support Tickets')
@Controller('support-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SupportTicketsController {
  constructor(private supportTicketsService: SupportTicketsService) {}

  @Post()
  @ApiOperation({ summary: 'Create support ticket' })
  create(@Body() data: any) {
    return this.supportTicketsService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all support tickets' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.supportTicketsService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get support ticket by ID' })
  findOne(@Param('id') id: string) {
    return this.supportTicketsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update support ticket' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.supportTicketsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete support ticket' })
  remove(@Param('id') id: string) {
    return this.supportTicketsService.remove(id);
  }
}
