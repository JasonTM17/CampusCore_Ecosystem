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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SupportTicketsService } from './support-tickets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Support Tickets')
@Controller('support-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SupportTicketsController {
  constructor(private supportTicketsService: SupportTicketsService) {}

  // ============ USER ENDPOINTS ============

  @Post()
  @ApiOperation({ summary: 'Create support ticket' })
  create(@CurrentUser() user: any, @Body() data: any) {
    return this.supportTicketsService.create({ ...data, userId: user.sub });
  }

  @Get('my')
  @ApiOperation({ summary: 'Get current user tickets' })
  getMyTickets(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.supportTicketsService.findByUser(
      user.sub,
      page || 1,
      limit || 20,
    );
  }

  @Get('my/:id')
  @ApiOperation({ summary: 'Get current user ticket by ID' })
  getMyTicket(@CurrentUser() user: any, @Param('id') id: string) {
    return this.supportTicketsService.findOneByUser(id, user.sub);
  }

  // ============ ADMIN ENDPOINTS ============

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all support tickets' })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
  ) {
    return this.supportTicketsService.findAll(
      page || 1,
      limit || 20,
      status,
      priority,
      category,
    );
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

  @Post(':id/assign')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Assign support ticket' })
  assign(@Param('id') id: string, @Body() data: { assignedTo: string }) {
    return this.supportTicketsService.assign(id, data.assignedTo);
  }

  @Post(':id/respond')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Respond to support ticket' })
  respond(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() data: { message: string; isInternal?: boolean },
  ) {
    return this.supportTicketsService.addResponse(
      id,
      user.sub,
      data.message,
      data.isInternal,
    );
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete support ticket' })
  remove(@Param('id') id: string) {
    return this.supportTicketsService.remove(id);
  }
}
