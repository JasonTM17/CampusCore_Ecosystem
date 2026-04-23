import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentLecturer } from '../auth/decorators/current-user.decorator';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  // ============ ADMIN ENDPOINTS ============

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
  getEnrollmentTrends(@Query('months') months?: string) {
    const parsedMonths = months ? Number(months) : undefined;
    return this.analyticsService.getEnrollmentTrends(parsedMonths);
  }

  @Get('finance-summary')
  @Roles('ADMIN', 'SUPER_ADMIN', 'FINANCE_OFFICER')
  @ApiOperation({ summary: 'Get finance summary for admin cockpit' })
  getFinanceSummary() {
    return this.analyticsService.getFinanceSummary();
  }

  @Get('notification-summary')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get notification delivery summary for admin cockpit',
  })
  getNotificationSummary() {
    return this.analyticsService.getNotificationSummary();
  }

  @Get('registration-pressure')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get registration pressure summary for admin cockpit',
  })
  getRegistrationPressure() {
    return this.analyticsService.getRegistrationPressure();
  }

  @Get('operator-summary')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get operator summary links and health posture' })
  getOperatorSummary() {
    return this.analyticsService.getOperatorSummary();
  }

  @Get('cockpit')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get the admin analytics cockpit payload' })
  getCockpit() {
    return this.analyticsService.getCockpit();
  }

  @Get('revenue')
  @Roles('ADMIN', 'SUPER_ADMIN', 'FINANCE_OFFICER')
  @ApiOperation({ summary: 'Get revenue analytics (admin only)' })
  getRevenueAnalytics(@Query('semesterId') semesterId?: string) {
    return this.analyticsService.getRevenueAnalytics(semesterId);
  }

  @Get('attendance')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get attendance analytics (admin only)' })
  getAttendanceAnalytics(@Query('semesterId') semesterId?: string) {
    return this.analyticsService.getAttendanceAnalytics(semesterId);
  }

  @Get('top-courses')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get top courses by enrollment (admin only)' })
  getTopCourses(@Query('limit') limit?: number) {
    return this.analyticsService.getTopCourses(limit || 10);
  }

  @Get('student-statistics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get student statistics (admin only)' })
  getStudentStatistics() {
    return this.analyticsService.getStudentStatistics();
  }

  // ============ LECTURER ENDPOINTS ============

  @Get('lecturer/my')
  @Roles('LECTURER')
  @ApiOperation({ summary: 'Get lecturer analytics' })
  getMyAnalytics(@CurrentLecturer() lecturerId: string) {
    return this.analyticsService.getLecturerAnalytics(lecturerId);
  }

  @Get('lecturer/sections')
  @Roles('LECTURER')
  @ApiOperation({ summary: 'Get lecturer section analytics' })
  getMySectionAnalytics(@CurrentLecturer() lecturerId: string) {
    return this.analyticsService.getLecturerSectionAnalytics(lecturerId);
  }
}
