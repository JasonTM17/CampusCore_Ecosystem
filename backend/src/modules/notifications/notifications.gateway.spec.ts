import { NotificationsGateway } from './notifications.gateway';
import { AuthService } from '../auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;

  const jwtService = {
    verifyAsync: jest.fn(),
  };

  const authService = {
    validateUser: jest.fn(),
  };

  const configService = {
    get: jest.fn().mockReturnValue('http://localhost'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new NotificationsGateway(
      jwtService as unknown as JwtService,
      authService as unknown as AuthService,
      configService as unknown as ConfigService,
    );
    gateway.server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  const buildClient = () =>
    ({
      id: 'socket-1',
      handshake: {
        auth: { token: 'access-token' },
        headers: {
          origin: 'http://localhost',
        },
      },
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      data: {},
    }) as any;

  it('should authenticate sockets using the JWT handshake token', async () => {
    const client = buildClient();
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-uuid' });
    authService.validateUser.mockResolvedValue({
      id: 'user-uuid',
      email: 'student1@campuscore.edu',
      roles: ['ADMIN', 'STUDENT'],
      permissions: [],
      studentId: null,
      lecturerId: null,
    });

    await gateway.handleConnection(client);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('access-token');
    expect(authService.validateUser).toHaveBeenCalledWith('user-uuid');
    expect(client.join).toHaveBeenCalledWith('user:user-uuid');
    expect(client.join).toHaveBeenCalledWith('role:ADMIN');
    expect(client.join).toHaveBeenCalledWith('role:STUDENT');
    expect(gateway.getConnectedClientsCount()).toBe(1);
  });

  it('should disconnect sockets that fail JWT verification', async () => {
    const client = buildClient();
    jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(gateway.getConnectedClientsCount()).toBe(0);
  });

  it('should reject sockets from disallowed origins', async () => {
    const client = buildClient();
    client.handshake.headers.origin = 'http://evil.example';

    await gateway.handleConnection(client);

    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('should ignore forged user claims from the authenticate event payload', async () => {
    const client = buildClient();
    client.data.user = {
      id: 'real-user',
      email: 'student1@campuscore.edu',
      roles: ['ADMIN'],
      permissions: [],
      studentId: null,
      lecturerId: null,
    };

    const result = await gateway.handleAuthentication(client, {
      channel: 'announcements',
      userId: 'spoofed-user',
      role: 'SUPER_ADMIN',
    });

    expect(result).toEqual({
      status: 'authenticated',
      userId: 'real-user',
      roles: ['ADMIN'],
    });
    expect(client.join).toHaveBeenCalledWith('announcements');
    expect(client.join).not.toHaveBeenCalledWith('user:spoofed-user');
  });

  it('should reject subscribe attempts for another user channel', async () => {
    const client = buildClient();
    client.data.user = {
      id: 'real-user',
      email: 'student1@campuscore.edu',
      roles: ['STUDENT'],
      permissions: [],
      studentId: null,
      lecturerId: null,
    };

    const result = await gateway.handleSubscribe(client, {
      channel: 'user:spoofed-user',
    });

    expect(result).toEqual({
      status: 'forbidden',
      channel: 'user:spoofed-user',
    });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('should reject unsubscribe attempts for an unowned role channel', async () => {
    const client = buildClient();
    client.data.user = {
      id: 'real-user',
      email: 'student1@campuscore.edu',
      roles: ['STUDENT'],
      permissions: [],
      studentId: null,
      lecturerId: null,
    };

    const result = await gateway.handleUnsubscribe(client, {
      channel: 'role:SUPER_ADMIN',
    });

    expect(result).toEqual({
      status: 'forbidden',
      channel: 'role:SUPER_ADMIN',
    });
    expect(client.leave).not.toHaveBeenCalled();
  });
});
