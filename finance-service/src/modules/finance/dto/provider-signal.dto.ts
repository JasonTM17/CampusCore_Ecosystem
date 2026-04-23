import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsDate,
} from 'class-validator';
import { SandboxPaymentSignalStatus } from '../payment-orchestration.util';

export class ProviderSignalDto {
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsEnum(SandboxPaymentSignalStatus)
  status!: SandboxPaymentSignalStatus;

  @Transform(({ value }) => String(value).trim())
  @IsString()
  signature!: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  providerTransactionId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
