import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SandboxPaymentSignalStatus } from '../payment-orchestration.util';

export class SimulateSandboxPaymentSignalDto {
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsEnum(SandboxPaymentSignalStatus)
  status!: SandboxPaymentSignalStatus;

  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  providerTransactionId?: string;
}
