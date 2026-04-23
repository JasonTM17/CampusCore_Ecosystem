import { BadRequestException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export enum SandboxPaymentSignalStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  PROCESSING = 'PROCESSING',
}

export type PaymentActionFlow = 'REDIRECT' | 'QR' | 'APPROVAL' | 'HOSTED_CARD';

export type PaymentAttemptNextAction = {
  flow: PaymentActionFlow;
  redirectUrl?: string;
  approvalUrl?: string;
  hostedCheckoutUrl?: string;
  deeplinkUrl?: string;
  qrPayload?: string;
  qrCodeUrl?: string;
};

type SandboxSignatureInput = {
  provider: PaymentProvider;
  attemptToken: string;
  status: SandboxPaymentSignalStatus;
  providerTransactionId?: string;
};

export function parsePaymentProvider(value: string): PaymentProvider {
  const normalized = value.trim().toUpperCase();

  if (!(normalized in PaymentProvider)) {
    throw new BadRequestException(`Unsupported payment provider: ${value}`);
  }

  return PaymentProvider[normalized as keyof typeof PaymentProvider];
}

export function getPaymentProviderSegment(provider: PaymentProvider): string {
  return provider.toLowerCase();
}

export function buildSandboxSignaturePayload({
  provider,
  attemptToken,
  status,
  providerTransactionId,
}: SandboxSignatureInput): string {
  return [
    provider,
    attemptToken.trim(),
    status,
    providerTransactionId?.trim() ?? '',
  ].join('|');
}

export function signSandboxPaymentSignal(
  secret: string,
  input: SandboxSignatureInput,
): string {
  return createHmac('sha256', secret)
    .update(buildSandboxSignaturePayload(input))
    .digest('hex');
}

export function verifySandboxPaymentSignal(
  secret: string,
  signature: string,
  input: SandboxSignatureInput,
): boolean {
  const expected = Buffer.from(signSandboxPaymentSignal(secret, input), 'utf8');
  const actual = Buffer.from(signature.trim(), 'utf8');

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function buildReference(prefix: string): string {
  const timestamp = new Date().toISOString().replace(/\D/gu, '').slice(0, 14);
  const suffix = randomUUID().replace(/-/gu, '').slice(0, 8).toUpperCase();
  return `${prefix}-${timestamp}-${suffix}`;
}

export function createPaymentIntentNumber(): string {
  return buildReference('PINT');
}

export function createPaymentAttemptNumber(): string {
  return buildReference('PATT');
}

export function createPaymentAttemptToken(): string {
  return randomUUID();
}

export function createSandboxProviderReference(
  provider: PaymentProvider,
  attemptNumber: string,
): string {
  return `${provider}-${attemptNumber}`.replace(/\s+/gu, '-');
}

export function buildSandboxProviderNextAction(input: {
  provider: PaymentProvider;
  handoffUrl: string;
  publicToken: string;
}): PaymentAttemptNextAction {
  const { provider, handoffUrl, publicToken } = input;

  switch (provider) {
    case PaymentProvider.MOMO:
      return {
        flow: 'REDIRECT',
        redirectUrl: handoffUrl,
        deeplinkUrl: `momo://sandbox/checkout/${publicToken}`,
      };
    case PaymentProvider.ZALOPAY:
      return {
        flow: 'QR',
        redirectUrl: handoffUrl,
        deeplinkUrl: `zalopay://sandbox/checkout/${publicToken}`,
        qrPayload: `zalopay:sandbox:${publicToken}`,
      };
    case PaymentProvider.VNPAY:
      return {
        flow: 'REDIRECT',
        redirectUrl: handoffUrl,
      };
    case PaymentProvider.PAYPAL:
      return {
        flow: 'APPROVAL',
        approvalUrl: handoffUrl,
      };
    case PaymentProvider.CARD:
      return {
        flow: 'HOSTED_CARD',
        hostedCheckoutUrl: handoffUrl,
      };
    default:
      return {
        flow: 'REDIRECT',
        redirectUrl: handoffUrl,
      };
  }
}
