import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ServiceTokenGuard } from './guards/service-token.guard';
import { AuthContextService } from './auth-context.service';

@ApiExcludeController()
@Controller('internal/people-context')
@UseGuards(ServiceTokenGuard)
export class PeopleContextAliasController {
  constructor(private readonly authContextService: AuthContextService) {}

  @Get('users/:userId')
  getUser(@Param('userId') userId: string) {
    return this.authContextService.getUser(userId);
  }
}
