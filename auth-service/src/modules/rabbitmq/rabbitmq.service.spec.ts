import { ConfigService } from '@nestjs/config';
import { RabbitMQService } from './rabbitmq.service';

describe('RabbitMQService', () => {
  let service: RabbitMQService;
  let configService: { get: jest.Mock<string | undefined, [string]> };

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    };
    service = new RabbitMQService(configService as unknown as ConfigService);
  });

  it('treats missing configuration as disabled', async () => {
    configService.get.mockReturnValue(undefined);

    await service.onModuleInit();

    expect(service.isConfigured()).toBe(false);
    expect(service.isConnected()).toBe(false);
  });

  it('publishes messages to supported queues', async () => {
    const sendToQueue = jest.fn().mockReturnValue(true);
    (
      service as unknown as {
        configured: boolean;
        rabbitMqUrl: string;
        connection: unknown;
        channel: { sendToQueue: jest.Mock<boolean, unknown[]> };
      }
    ).configured = true;
    (
      service as unknown as {
        rabbitMqUrl: string;
      }
    ).rabbitMqUrl = 'amqp://test';
    (
      service as unknown as {
        connection: unknown;
      }
    ).connection = {};
    (
      service as unknown as {
        channel: { sendToQueue: jest.Mock<boolean, unknown[]> };
      }
    ).channel = { sendToQueue };

    await expect(
      service.publishMessage('notifications', { title: 'Ping' }),
    ).resolves.toBe(true);

    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications',
      expect.any(Buffer),
      { persistent: true },
    );
  });

  it('rejects publish attempts to unsupported queues', async () => {
    const sendToQueue = jest.fn().mockReturnValue(true);
    (
      service as unknown as {
        configured: boolean;
        rabbitMqUrl: string;
        connection: unknown;
        channel: { sendToQueue: jest.Mock<boolean, unknown[]> };
      }
    ).configured = true;
    (
      service as unknown as {
        rabbitMqUrl: string;
      }
    ).rabbitMqUrl = 'amqp://test';
    (
      service as unknown as {
        connection: unknown;
      }
    ).connection = {};
    (
      service as unknown as {
        channel: { sendToQueue: jest.Mock<boolean, unknown[]> };
      }
    ).channel = { sendToQueue };

    await expect(
      service.publishMessage('unsupported' as never, { title: 'Ping' }),
    ).resolves.toBe(false);

    expect(sendToQueue).not.toHaveBeenCalled();
  });
});
