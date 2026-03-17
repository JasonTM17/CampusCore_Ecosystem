import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RabbitMQService } from './rabbitmq.service';

@ApiTags('RabbitMQ')
@Controller('rabbitmq')
export class RabbitMQController {
  constructor(private readonly rabbitMQService: RabbitMQService) {}

  @Get('health')
  @ApiOperation({ summary: 'Check RabbitMQ connection health' })
  async health() {
    const isConnected = !!this.rabbitMQService.getChannel();
    return {
      status: isConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('publish')
  @ApiOperation({ summary: 'Publish message to queue' })
  async publish(@Body() body: { queue: string; message: any }) {
    const result = await this.rabbitMQService.publishMessage(body.queue, body.message);
    return { success: result };
  }
}
