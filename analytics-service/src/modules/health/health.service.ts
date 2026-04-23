import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

type DependencyStatus = {
  status: 'up' | 'down' | 'not_configured';
  latency?: number;
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'campuscore-analytics-service',
    };
  }

  async readiness() {
    const database = await this.checkDatabase();
    const rabbitmq = await this.checkRabbitMQ();

    return {
      status:
        database.status === 'down' || rabbitmq.status === 'down'
          ? 'degraded'
          : 'ok',
      timestamp: new Date().toISOString(),
      service: 'campuscore-analytics-service',
      services: {
        database,
        rabbitmq,
      },
    };
  }

  async metrics() {
    const readiness = await this.readiness();
    const services = readiness.services;
    const rssBytes = process.memoryUsage().rss;
    const heapUsedBytes = process.memoryUsage().heapUsed;
    const domainMetrics = await this.getDomainMetrics();

    return [
      '# HELP campuscore_service_up Service liveness status.',
      '# TYPE campuscore_service_up gauge',
      'campuscore_service_up{service="campuscore-analytics-service"} 1',
      '# HELP campuscore_dependency_up Dependency status by service.',
      '# TYPE campuscore_dependency_up gauge',
      `campuscore_dependency_up{service="campuscore-analytics-service",dependency="database"} ${services.database.status === 'up' ? 1 : 0}`,
      `campuscore_dependency_up{service="campuscore-analytics-service",dependency="rabbitmq"} ${services.rabbitmq.status === 'up' ? 1 : 0}`,
      '# HELP campuscore_dependency_latency_ms Dependency latency in milliseconds.',
      '# TYPE campuscore_dependency_latency_ms gauge',
      `campuscore_dependency_latency_ms{service="campuscore-analytics-service",dependency="database"} ${services.database.latency ?? 0}`,
      `campuscore_dependency_latency_ms{service="campuscore-analytics-service",dependency="rabbitmq"} ${services.rabbitmq.latency ?? 0}`,
      '# HELP process_resident_memory_bytes Resident memory usage in bytes.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes{service="campuscore-analytics-service"} ${rssBytes}`,
      '# HELP process_heap_used_bytes Heap usage in bytes.',
      '# TYPE process_heap_used_bytes gauge',
      `process_heap_used_bytes{service="campuscore-analytics-service"} ${heapUsedBytes}`,
      ...domainMetrics,
    ].join('\n');
  }

  private async getDomainMetrics(): Promise<string[]> {
    const [
      enrollmentsByStatus,
      waitlistsByStatus,
      invoicesByStatus,
      paymentsByStatus,
      paymentsByMethod,
      notificationsByType,
      sections,
    ] = await Promise.all([
      this.prisma.enrollment.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.waitlist.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method', 'status'],
        _count: { id: true },
      }),
      this.prisma.notification.groupBy({
        by: ['type', 'isRead'],
        _count: { id: true },
      }),
      this.prisma.section.findMany({
        select: {
          id: true,
          capacity: true,
          enrolledCount: true,
        },
      }),
    ]);

    const fullSections = sections.filter(
      (section) =>
        section.capacity > 0 && section.enrolledCount >= section.capacity,
    ).length;
    const nearCapacitySections = sections.filter((section) => {
      if (section.capacity <= 0 || section.enrolledCount >= section.capacity) {
        return false;
      }
      return section.enrolledCount / section.capacity >= 0.8;
    }).length;
    const averageOccupancy =
      sections.length > 0
        ? sections.reduce((sum, section) => {
            if (section.capacity <= 0) {
              return sum;
            }
            return sum + section.enrolledCount / section.capacity;
          }, 0) / sections.length
        : 0;

    return [
      '# HELP campuscore_enrollment_status_total Enrollment rows by status.',
      '# TYPE campuscore_enrollment_status_total gauge',
      ...enrollmentsByStatus.map(
        (item) =>
          `campuscore_enrollment_status_total{service="campuscore-analytics-service",status="${safeMetricLabel(item.status)}"} ${item._count.id}`,
      ),
      '# HELP campuscore_waitlist_status_total Waitlist rows by status.',
      '# TYPE campuscore_waitlist_status_total gauge',
      ...waitlistsByStatus.map(
        (item) =>
          `campuscore_waitlist_status_total{service="campuscore-analytics-service",status="${safeMetricLabel(item.status)}"} ${item._count.id}`,
      ),
      '# HELP campuscore_invoice_status_total Invoice rows by status.',
      '# TYPE campuscore_invoice_status_total gauge',
      ...invoicesByStatus.map(
        (item) =>
          `campuscore_invoice_status_total{service="campuscore-analytics-service",status="${safeMetricLabel(item.status)}"} ${item._count.id}`,
      ),
      '# HELP campuscore_invoice_status_amount_total Invoice amount by status.',
      '# TYPE campuscore_invoice_status_amount_total gauge',
      ...invoicesByStatus.map(
        (item) =>
          `campuscore_invoice_status_amount_total{service="campuscore-analytics-service",status="${safeMetricLabel(item.status)}"} ${Number(item._sum.total ?? 0)}`,
      ),
      '# HELP campuscore_payment_status_total Payment rows by status.',
      '# TYPE campuscore_payment_status_total gauge',
      ...paymentsByStatus.map(
        (item) =>
          `campuscore_payment_status_total{service="campuscore-analytics-service",status="${safeMetricLabel(item.status)}"} ${item._count.id}`,
      ),
      '# HELP campuscore_payment_status_amount_total Payment amount by status.',
      '# TYPE campuscore_payment_status_amount_total gauge',
      ...paymentsByStatus.map(
        (item) =>
          `campuscore_payment_status_amount_total{service="campuscore-analytics-service",status="${safeMetricLabel(item.status)}"} ${Number(item._sum.amount ?? 0)}`,
      ),
      '# HELP campuscore_payment_provider_status_total Payment rows by provider and status.',
      '# TYPE campuscore_payment_provider_status_total gauge',
      ...paymentsByMethod.map(
        (item) =>
          `campuscore_payment_provider_status_total{service="campuscore-analytics-service",provider="${safeMetricLabel(item.method)}",status="${safeMetricLabel(item.status)}"} ${item._count.id}`,
      ),
      '# HELP campuscore_notification_delivery_total Notification rows by type and read state.',
      '# TYPE campuscore_notification_delivery_total gauge',
      ...notificationsByType.map(
        (item) =>
          `campuscore_notification_delivery_total{service="campuscore-analytics-service",type="${safeMetricLabel(item.type)}",read_state="${item.isRead ? 'read' : 'unread'}"} ${item._count.id}`,
      ),
      '# HELP campuscore_section_pressure_total Section pressure buckets.',
      '# TYPE campuscore_section_pressure_total gauge',
      `campuscore_section_pressure_total{service="campuscore-analytics-service",bucket="full"} ${fullSections}`,
      `campuscore_section_pressure_total{service="campuscore-analytics-service",bucket="near_capacity"} ${nearCapacitySections}`,
      '# HELP campuscore_section_average_occupancy_ratio Average section occupancy ratio.',
      '# TYPE campuscore_section_average_occupancy_ratio gauge',
      `campuscore_section_average_occupancy_ratio{service="campuscore-analytics-service"} ${averageOccupancy.toFixed(4)}`,
    ];
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'up',
        latency: Date.now() - start,
      };
    } catch (error) {
      this.logger.error('Database health check failed', error as Error);
      return { status: 'down' };
    }
  }

  private async checkRabbitMQ(): Promise<DependencyStatus> {
    try {
      if (!this.rabbitMQService.isConfigured()) {
        return { status: 'not_configured' };
      }

      const start = Date.now();
      const isConnected = this.rabbitMQService.isConnected();
      return {
        status: isConnected ? 'up' : 'down',
        latency: Date.now() - start,
      };
    } catch (error) {
      this.logger.error('RabbitMQ health check failed', error as Error);
      return { status: 'down' };
    }
  }
}

function safeMetricLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
