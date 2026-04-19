import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RabbitMQController } from './rabbitmq.controller';
import { RabbitMQService } from './rabbitmq.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('RabbitMQController', () => {
  const rabbitMQService = {
    publishMessage: jest.fn(),
    isConnected: jest.fn(),
  };

  let controller: RabbitMQController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RabbitMQController(
      rabbitMQService as unknown as RabbitMQService,
    );
  });

  it('protects publish behind admin-only auth guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      RabbitMQController.prototype.publish,
    );
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      RabbitMQController.prototype.publish,
    );

    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('delegates valid publish requests to the service', async () => {
    rabbitMQService.publishMessage.mockResolvedValue(true);

    await expect(
      controller.publish({
        queue: 'notifications',
        message: { title: 'Ping' },
      }),
    ).resolves.toEqual({ success: true });

    expect(rabbitMQService.publishMessage).toHaveBeenCalledWith(
      'notifications',
      { title: 'Ping' },
    );
  });
});
