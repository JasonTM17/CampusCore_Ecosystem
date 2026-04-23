import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentStudent } from '../auth/decorators/current-user.decorator';

@ApiTags('Waitlist')
@Controller('waitlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class WaitlistController {
  constructor(private waitlistService: WaitlistService) {}

  @Get('section/:sectionId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Get waitlist for a section' })
  findBySection(@Param('sectionId') sectionId: string) {
    return this.waitlistService.findBySection(sectionId);
  }

  @Post(':id/promote')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Promote student from waitlist to enrolled' })
  promoteStudent(@Param('id') id: string) {
    return this.waitlistService.promoteStudent(id);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all waitlist entries' })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.waitlistService.findAll(page || 1, limit || 20, sectionId);
  }

  @Get('my')
  @Roles('STUDENT')
  @ApiOperation({
    summary: 'Get active waitlist entries for the current student',
  })
  findMyWaitlist(@CurrentStudent() studentId: string) {
    return this.waitlistService.findByStudent(studentId);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'LECTURER')
  @ApiOperation({ summary: 'Get waitlist entry by ID' })
  findOne(@Param('id') id: string) {
    return this.waitlistService.findOne(id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  @ApiOperation({ summary: 'Remove from waitlist' })
  remove(@Param('id') id: string, @CurrentStudent() studentId?: string) {
    return this.waitlistService.remove(id, studentId);
  }
}
