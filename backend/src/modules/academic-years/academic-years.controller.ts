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
import { AcademicYearsService } from './academic-years.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('AcademicYears')
@Controller('academic-years')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AcademicYearsController {
  constructor(private academicYearsService: AcademicYearsService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create academic year' })
  create(@Body() data: any) {
    return this.academicYearsService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all academic years' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.academicYearsService.findAll(page || 1, limit || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get academic year by ID' })
  findOne(@Param('id') id: string) {
    return this.academicYearsService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update academic year' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.academicYearsService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete academic year' })
  remove(@Param('id') id: string) {
    return this.academicYearsService.remove(id);
  }
}
