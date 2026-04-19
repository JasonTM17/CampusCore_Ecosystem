export const RABBITMQ_ALLOWED_QUEUES = [
  'notifications',
  'emails',
  'analytics',
  'people-shadow',
  'audit-log-events',
  'auth-shadow',
] as const;

export type RabbitMQAllowedQueue = (typeof RABBITMQ_ALLOWED_QUEUES)[number];
