import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AuthContextService } from './auth-context.service';
import { ServiceTokenGuard } from './guards/service-token.guard';

@ApiExcludeController()
@Controller('internal/auth-context')
@UseGuards(ServiceTokenGuard)
export class AuthContextController {
  constructor(private readonly authContextService: AuthContextService) {}

  @Get('users/:userId')
  getUser(@Param('userId') userId: string) {
    return this.authContextService.getUser(userId);
  }
}
