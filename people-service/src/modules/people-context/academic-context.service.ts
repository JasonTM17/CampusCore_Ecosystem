import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';

export type AcademicDepartmentSnapshot = {
  id: string;
  code: string;
  name: string;
};

export type AcademicCurriculumSnapshot = {
  id: string;
  code: string;
  name: string;
  department: AcademicDepartmentSnapshot | null;
};

type StudentEnrollmentHistory = Array<Record<string, unknown>>;

@Injectable()
export class AcademicContextService {
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>(ENV.ACADEMIC_SERVICE_INTERNAL_URL) ??
      ENV_DEFAULTS.ACADEMIC_SERVICE_INTERNAL_URL
    ).replace(/\/+$/u, '');
    this.serviceToken = this.configService.getOrThrow<string>(
      ENV.INTERNAL_SERVICE_TOKEN,
    );
  }

  async getCurriculum(
    curriculumId: string,
  ): Promise<AcademicCurriculumSnapshot> {
    return this.fetchJson<AcademicCurriculumSnapshot>(
      `/api/v1/internal/academic-context/curricula/${curriculumId}`,
    );
  }

  async getDepartment(
    departmentId: string,
  ): Promise<AcademicDepartmentSnapshot> {
    return this.fetchJson<AcademicDepartmentSnapshot>(
      `/api/v1/internal/academic-context/departments/${departmentId}`,
    );
  }

  async getStudentEnrollments(
    studentId: string,
  ): Promise<StudentEnrollmentHistory> {
    return this.fetchJson<StudentEnrollmentHistory>(
      `/api/v1/internal/academic-context/students/${studentId}/enrollments`,
    );
  }

  private async fetchJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      headers: {
        'X-Service-Token': this.serviceToken,
      },
    });

    if (response.status === 404) {
      throw new NotFoundException(`Academic context not found for ${pathname}`);
    }

    if (response.status === 400) {
      throw new BadRequestException(
        `Invalid academic context request for ${pathname}`,
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Academic service request failed with status ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }
}
