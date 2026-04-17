import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '@prisma/client';

@ApiTags('Roles')
@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get all roles' })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get role by ID' })
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a new role' })
  create(@Body() data: { name: RoleName; description?: string }) {
    return this.rolesService.create(data);
  }

  @Put(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Update role' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.rolesService.update(id, data);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete role' })
  remove(@Param('id') id: string) {
    return this.rolesService.delete(id);
  }

  @Post(':id/permissions')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Assign permission to role' })
  assignPermission(
    @Param('id') id: string,
    @Body('permissionId') permissionId: string,
  ) {
    return this.rolesService.assignPermission(id, permissionId);
  }

  @Delete(':id/permissions/:permissionId')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Remove permission from role' })
  removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
  ) {
    return this.rolesService.removePermission(id, permissionId);
  }
}
