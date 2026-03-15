import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('overview')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get analytics overview (admin only)' })
  getOverview() {
    return this.analyticsService.getOverview();
  }

  @Get('enrollments-by-semester')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get enrollment counts by semester (admin only)' })
  getEnrollmentsBySemester() {
    return this.analyticsService.getEnrollmentsBySemester();
  }

  @Get('section-occupancy')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get section occupancy rates (admin only)' })
  getSectionOccupancy() {
    return this.analyticsService.getSectionOccupancy();
  }

  @Get('grade-distribution')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get grade distribution (admin only)' })
  getGradeDistribution() {
    return this.analyticsService.getGradeDistribution();
  }

  @Get('enrollment-trends')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get enrollment trends (admin only)' })
  getEnrollmentTrends() {
    return this.analyticsService.getEnrollmentTrends();
  }
}
