import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { ENV } from '../../config/env.constants';
import {
  NOTIFICATION_EVENTS_QUEUE,
  PEOPLE_SHADOW_ACADEMIC_QUEUE,
} from './rabbitmq.events';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private rabbitMqUrl: string | null = null;
  private connectPromise: Promise<boolean> | null = null;
  private configured = false;
  private readonly logger = new Logger(RabbitMQService.name);
  private readonly maxConnectAttempts = 12;
  private readonly retryDelayMs = 5_000;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>(ENV.RABBITMQ_URL);
    const hasSupportedScheme =
      typeof url === 'string' &&
      (url.startsWith('amqp://') || url.startsWith('amqps://'));

    this.configured = hasSupportedScheme;
    this.rabbitMqUrl = hasSupportedScheme ? url : null;

    if (!hasSupportedScheme) {
      this.logger.warn('RABBITMQ_URL not configured, skipping connection');
      return;
    }

    await this.ensureConnected();
  }

  async onModuleDestroy() {
    await this.resetConnection();
  }

  async publishMessage(message: unknown): Promise<boolean> {
    const connected = await this.ensureConnected();
    if (!connected || !this.channel) {
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
      this.logger.error('Failed to publish academic event', error as Error);
      return false;
    }
  }

  async consumeMessages(
    queue: typeof PEOPLE_SHADOW_ACADEMIC_QUEUE,
    callback: (message: unknown) => Promise<void> | void,
  ): Promise<void> {
    const connected = await this.ensureConnected();
    if (!connected || !this.channel) {
      this.logger.warn('RabbitMQ channel not initialized');
      return;
    }

    await this.channel.assertQueue(queue, {
      durable: true,
    });

    await this.channel.consume(queue, async (msg) => {
      if (!msg) {
        return;
      }

      try {
        const content = JSON.parse(msg.content.toString()) as unknown;
        await callback(content);
        this.channel?.ack(msg);
      } catch (error) {
        this.logger.error(`Failed to consume message from ${queue}`, error);
        this.channel?.nack(msg, false, false);
      }
    });
  }

  isConfigured() {
    return this.configured;
  }

  isConnected() {
    return Boolean(this.connection && this.channel);
  }

  private async ensureConnected(): Promise<boolean> {
    if (!this.configured || !this.rabbitMqUrl) {
      return false;
    }

    if (this.connection && this.channel) {
      return true;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.connectWithRetry().finally(() => {
        this.connectPromise = null;
      });
    }

    return this.connectPromise;
  }

  private async connectWithRetry(): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxConnectAttempts; attempt += 1) {
      try {
        await this.resetConnection();
        const connection = await amqp.connect(this.rabbitMqUrl!);
        const channel = await connection.createChannel();

        this.connection = connection;
        this.channel = channel;

        this.registerConnectionListeners(connection);
        this.registerChannelListeners(channel);

        for (const queue of [
          NOTIFICATION_EVENTS_QUEUE,
          PEOPLE_SHADOW_ACADEMIC_QUEUE,
        ]) {
          await channel.assertQueue(queue, {
            durable: true,
          });
        }

        this.logger.log(`Connected to RabbitMQ on attempt ${attempt}`);
        return true;
      } catch (error) {
        if (attempt === this.maxConnectAttempts) {
          this.logger.error('Failed to connect to RabbitMQ', error as Error);
          return false;
        }

        this.logger.warn(
          `RabbitMQ connect attempt ${attempt}/${this.maxConnectAttempts} failed: ${this.formatError(error)}. Retrying in ${this.retryDelayMs}ms`,
        );
        await this.delay(this.retryDelayMs);
      }
    }

    return false;
  }

  private registerConnectionListeners(connection: amqp.ChannelModel) {
    connection.on('error', (error) => {
      this.logger.error('RabbitMQ connection error', error as Error);
    });
    connection.on('close', () => {
      if (this.connection === connection) {
        this.connection = null;
        this.channel = null;
      }
      this.logger.warn('RabbitMQ connection closed');
    });
  }

  private registerChannelListeners(channel: amqp.Channel) {
    channel.on('error', (error) => {
      this.logger.error('RabbitMQ channel error', error as Error);
    });
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = null;
      }
      this.logger.warn('RabbitMQ channel closed');
    });
  }

  private async resetConnection() {
    const channel = this.channel;
    const connection = this.connection;

    this.channel = null;
    this.connection = null;

    if (channel) {
      try {
        await channel.close();
      } catch {}
    }

    if (connection) {
      try {
        await connection.close();
      } catch {}
    }
  }

  private formatError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
