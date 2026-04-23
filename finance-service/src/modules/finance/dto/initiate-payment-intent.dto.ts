import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { PaymentProvider } from '@prisma/client';

export class InitiatePaymentIntentDto {
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  returnUrl?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  cancelUrl?: string;
}
