import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { ENV } from '../../config/env.constants';
import {
  RABBITMQ_ALLOWED_QUEUES,
  RabbitMQAllowedQueue,
} from './rabbitmq.constants';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;
  private configured = false;
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private configService: ConfigService) {}

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
      this.connection.on('error', (error) => {
        this.logger.error('RabbitMQ connection error', error);
      });
      this.channel.on('error', (error) => {
        this.logger.error('RabbitMQ channel error', error);
      });

      for (const queue of RABBITMQ_ALLOWED_QUEUES) {
        await this.channel.assertQueue(queue, { durable: true });
      }

      this.logger.log('Connected to RabbitMQ');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ', error);
    }
  }

  async onModuleDestroy() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }

  async publishMessage(
    queue: RabbitMQAllowedQueue,
    message: unknown,
  ): Promise<boolean> {
    if (!this.channel) {
      this.logger.warn('Channel not initialized');
      return false;
    }

    if (!RABBITMQ_ALLOWED_QUEUES.includes(queue)) {
      this.logger.warn(`Rejected publish to unsupported queue: ${queue}`);
      return false;
    }

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message));
      return this.channel.sendToQueue(queue, messageBuffer, {
        persistent: true,
      });
    } catch (error) {
      this.logger.error(`Failed to publish message to ${queue}`, error);
      return false;
    }
  }

  async consumeMessages(
    queue: string,
    callback: (message: any) => Promise<void> | void,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn('Channel not initialized');
      return;
    }

    if (RABBITMQ_ALLOWED_QUEUES.includes(queue as RabbitMQAllowedQueue)) {
      await this.channel.assertQueue(queue, { durable: true });
    }

    await this.channel.consume(queue, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          await callback(content);
          this.channel.ack(msg);
        } catch (error) {
          this.logger.error(`Failed to consume message from ${queue}`, error);
          this.channel.nack(msg, false, false);
        }
      }
    });
  }

  getChannel(): amqp.Channel | null {
    return this.channel;
  }

  isConnected(): boolean {
    return Boolean(this.connection && this.channel);
  }

  isConfigured(): boolean {
    return this.configured;
  }
}
