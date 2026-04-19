import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { ENV } from '../../config/env.constants';
import { NOTIFICATION_EVENTS_QUEUE } from './rabbitmq.events';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private configured = false;
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>(ENV.RABBITMQ_URL);
    const hasSupportedScheme =
      typeof url === 'string' &&
      (url.startsWith('amqp://') || url.startsWith('amqps://'));

    this.configured = hasSupportedScheme;

    if (!hasSupportedScheme) {
      this.logger.warn('RABBITMQ_URL not configured, skipping connection');
      return;
    }

    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      await this.channel.assertQueue(NOTIFICATION_EVENTS_QUEUE, {
        durable: true,
      });
      this.logger.log('Connected to RabbitMQ');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ', error as Error);
    }
  }

  async onModuleDestroy() {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }

  async publishMessage(message: unknown): Promise<boolean> {
    if (!this.channel) {
      this.logger.warn('RabbitMQ channel not initialized');
      return false;
    }

    try {
      return this.channel.sendToQueue(
        NOTIFICATION_EVENTS_QUEUE,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
        },
      );
    } catch (error) {
      this.logger.error('Failed to publish engagement event', error as Error);
      return false;
    }
  }

  isConfigured() {
    return this.configured;
  }

  isConnected() {
    return Boolean(this.connection && this.channel);
  }
}
