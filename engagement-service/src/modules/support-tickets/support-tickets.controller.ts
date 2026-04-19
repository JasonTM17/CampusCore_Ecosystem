import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { AssignSupportTicketDto } from './dto/assign-support-ticket.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { CreateTicketResponseDto } from './dto/create-ticket-response.dto';
import { ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { SupportTicketsService } from './support-tickets.service';

@ApiTags('Support Tickets')
@Controller('support-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SupportTicketsController {
  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  @Post()
  @ApiOperation({ summary: 'Create support ticket' })
  create(@CurrentUser() user: AuthUser, @Body() data: CreateSupportTicketDto) {
    return this.supportTicketsService.create({
      ...data,
      userId: user.id,
      userEmail: user.email,
      userDisplayName:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.email,
    });
  }

  @Get('my')
  @ApiOperation({ summary: 'Get current user tickets' })
  getMyTickets(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSupportTicketsQueryDto,
  ) {
    return this.supportTicketsService.findByUser(
      user.id,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('my/:id')
  @ApiOperation({ summary: 'Get current user ticket by ID' })
  getMyTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.supportTicketsService.findOneByUser(id, user.id);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all support tickets' })
  findAll(@Query() query: ListSupportTicketsQueryDto) {
    return this.supportTicketsService.findAll(
      query.page ?? 1,
      query.limit ?? 20,
      query.status,
      query.priority,
      query.category,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get support ticket by ID' })
  findOne(@Param('id') id: string) {
    return this.supportTicketsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update support ticket' })
  update(@Param('id') id: string, @Body() data: UpdateSupportTicketDto) {
    return this.supportTicketsService.update(id, data);
  }

  @Post(':id/assign')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Assign support ticket' })
  assign(@Param('id') id: string, @Body() data: AssignSupportTicketDto) {
    return this.supportTicketsService.assign(id, data.assignedTo);
  }

  @Post(':id/respond')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Respond to support ticket' })
  respond(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() data: CreateTicketResponseDto,
  ) {
    return this.supportTicketsService.addResponse(
      id,
      user.id,
      user.email,
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.email,
      data.message,
      data.isInternal ?? false,
    );
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete support ticket' })
  remove(@Param('id') id: string) {
    return this.supportTicketsService.remove(id);
  }
}
