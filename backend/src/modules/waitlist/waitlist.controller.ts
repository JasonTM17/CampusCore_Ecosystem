import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Waitlist')
@Controller('waitlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class WaitlistController {
  constructor(private waitlistService: WaitlistService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Add to waitlist' })
  create(@Body() data: any) {
    return this.waitlistService.create(data);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all waitlist entries' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.waitlistService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get waitlist entry by ID' })
  findOne(@Param('id') id: string) {
    return this.waitlistService.findOne(id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Remove from waitlist' })
  remove(@Param('id') id: string) {
    return this.waitlistService.remove(id);
  }
}
