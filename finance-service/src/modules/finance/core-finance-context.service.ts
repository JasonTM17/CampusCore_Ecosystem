import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';

export type FinanceContextStudent = {
  id: string;
  userId: string;
  studentCode: string;
  displayName: string;
  email: string;
};

export type FinanceContextSemester = {
  id: string;
  name: string;
  endDate: string | null;
};

export type FinanceBillableStudent = FinanceContextStudent & {
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
};

@Injectable()
export class CoreFinanceContextService {
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>(ENV.CORE_API_INTERNAL_URL) ??
      ENV_DEFAULTS.CORE_API_INTERNAL_URL
    ).replace(/\/+$/u, '');
    this.serviceToken = this.configService.getOrThrow<string>(
      ENV.INTERNAL_SERVICE_TOKEN,
    );
  }

  async getStudent(studentId: string): Promise<FinanceContextStudent> {
    return this.fetchJson<FinanceContextStudent>(
      `/api/v1/internal/finance-context/students/${studentId}`,
    );
  }

  async getSemester(semesterId: string): Promise<FinanceContextSemester> {
    return this.fetchJson<FinanceContextSemester>(
      `/api/v1/internal/finance-context/semesters/${semesterId}`,
    );
  }

  async getBillableStudents(
    semesterId: string,
  ): Promise<{ semesterId: string; students: FinanceBillableStudent[] }> {
    return this.fetchJson<{
      semesterId: string;
      students: FinanceBillableStudent[];
    }>(
      `/api/v1/internal/finance-context/semesters/${semesterId}/billable-students`,
    );
  }

  private async fetchJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      headers: {
        'X-Service-Token': this.serviceToken,
      },
    });

    if (response.status === 404) {
      throw new NotFoundException(
        `Internal finance context not found for ${pathname}`,
      );
    }

    if (response.status === 400) {
      throw new BadRequestException(
        `Invalid finance context request for ${pathname}`,
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Core API finance context request failed with status ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }
}
