import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>('RABBITMQ_URL');
    if (!url) {
      this.logger.warn('RABBITMQ_URL not configured, skipping connection');
      return;
    }

    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      
      await this.channel.assertQueue('notifications', { durable: true });
      await this.channel.assertQueue('emails', { durable: true });
      await this.channel.assertQueue('analytics', { durable: true });
      
      this.logger.log('Connected to RabbitMQ');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ', error);
    }
  }

  async onModuleDestroy() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }

  async publishMessage(queue: string, message: any): Promise<boolean> {
    if (!this.channel) {
      this.logger.warn('Channel not initialized');
      return false;
    }

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message));
      return this.channel.sendToQueue(queue, messageBuffer, { persistent: true });
    } catch (error) {
      this.logger.error(`Failed to publish message to ${queue}`, error);
      return false;
    }
  }

  async consumeMessages(queue: string, callback: (message: any) => void): Promise<void> {
    if (!this.channel) {
      this.logger.warn('Channel not initialized');
      return;
    }

    await this.channel.consume(queue, (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());
        callback(content);
        this.channel.ack(msg);
      }
    });
  }

  getChannel(): amqp.Channel | null {
    return this.channel;
  }
}
