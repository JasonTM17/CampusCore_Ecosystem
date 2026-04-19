import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RabbitMQService } from './rabbitmq.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PublishMessageDto } from './dto/publish-message.dto';

@ApiTags('RabbitMQ')
@Controller('rabbitmq')
export class RabbitMQController {
  constructor(private readonly rabbitMQService: RabbitMQService) {}

  @Get('health')
  @ApiOperation({ summary: 'Check RabbitMQ connection health' })
  async health() {
    const isConnected = this.rabbitMQService.isConnected();
    return {
      status: isConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Publish message to queue' })
  async publish(@Body() body: PublishMessageDto) {
    const result = await this.rabbitMQService.publishMessage(
      body.queue,
      body.message,
    );
    return { success: result };
  }
}
