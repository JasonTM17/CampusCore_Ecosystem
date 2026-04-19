import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PeopleContextService } from './people-context.service';
import { ServiceTokenGuard } from '../finance-context/guards/service-token.guard';

@ApiExcludeController()
@Controller('internal/people-context')
@UseGuards(ServiceTokenGuard)
export class PeopleContextController {
  constructor(private readonly peopleContextService: PeopleContextService) {}

  @Get('users/:userId')
  getUser(@Param('userId') userId: string) {
    return this.peopleContextService.getUser(userId);
  }
}
