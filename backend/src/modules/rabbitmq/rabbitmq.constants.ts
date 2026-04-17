export const RABBITMQ_ALLOWED_QUEUES = [
  'notifications',
  'emails',
  'analytics',
] as const;

export type RabbitMQAllowedQueue = (typeof RABBITMQ_ALLOWED_QUEUES)[number];
