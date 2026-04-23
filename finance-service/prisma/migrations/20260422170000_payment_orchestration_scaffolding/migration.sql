-- Create enums
CREATE TYPE "PaymentProvider" AS ENUM ('MOMO', 'ZALOPAY', 'VNPAY', 'PAYPAL', 'CARD');

CREATE TYPE "PaymentIntentStatus" AS ENUM (
  'REQUIRES_ACTION',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'CREATED',
  'REDIRECT_REQUIRED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "PaymentSignalSource" AS ENUM (
  'INITIATION',
  'CALLBACK',
  'WEBHOOK',
  'SYSTEM'
);

CREATE TYPE "PaymentIntentEventType" AS ENUM (
  'INTENT_CREATED',
  'ATTEMPT_CREATED',
  'SIGNAL_RECEIVED',
  'VERIFICATION_PASSED',
  'VERIFICATION_FAILED',
  'STATE_TRANSITION',
  'PAYMENT_RECORDED',
  'MANUAL_REVIEW_REQUIRED'
);

-- Alter payment table
ALTER TABLE "Payment"
ADD COLUMN "paymentIntentId" TEXT;

-- Create payment intent table
CREATE TABLE "PaymentIntent" (
  "id" TEXT NOT NULL,
  "intentNumber" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'REQUIRES_ACTION',
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "metadata" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSignalAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- Create payment attempt table
CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "attemptNumber" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "idempotencyKey" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "providerReference" TEXT,
  "redirectUrl" TEXT,
  "callbackUrl" TEXT,
  "webhookUrl" TEXT,
  "returnUrl" TEXT,
  "cancelUrl" TEXT,
  "providerPayload" JSONB,
  "occurredAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- Create append-only event table
CREATE TABLE "PaymentIntentEvent" (
  "id" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "paymentAttemptId" TEXT,
  "type" "PaymentIntentEventType" NOT NULL,
  "source" "PaymentSignalSource" NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "fromIntentStatus" "PaymentIntentStatus",
  "toIntentStatus" "PaymentIntentStatus",
  "fromAttemptStatus" "PaymentAttemptStatus",
  "toAttemptStatus" "PaymentAttemptStatus",
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentIntentEvent_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "Payment_paymentIntentId_key" ON "Payment"("paymentIntentId");
CREATE UNIQUE INDEX "PaymentIntent_intentNumber_key" ON "PaymentIntent"("intentNumber");
CREATE INDEX "PaymentIntent_invoiceId_idx" ON "PaymentIntent"("invoiceId");
CREATE INDEX "PaymentIntent_studentId_idx" ON "PaymentIntent"("studentId");
CREATE INDEX "PaymentIntent_provider_idx" ON "PaymentIntent"("provider");
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");
CREATE INDEX "PaymentIntent_createdAt_idx" ON "PaymentIntent"("createdAt");

CREATE UNIQUE INDEX "PaymentAttempt_attemptNumber_key" ON "PaymentAttempt"("attemptNumber");
CREATE UNIQUE INDEX "PaymentAttempt_publicToken_key" ON "PaymentAttempt"("publicToken");
CREATE UNIQUE INDEX "PaymentAttempt_invoiceId_studentId_provider_idempotencyKey_key"
ON "PaymentAttempt"("invoiceId", "studentId", "provider", "idempotencyKey");
CREATE INDEX "PaymentAttempt_intentId_idx" ON "PaymentAttempt"("intentId");
CREATE INDEX "PaymentAttempt_status_idx" ON "PaymentAttempt"("status");
CREATE INDEX "PaymentAttempt_createdAt_idx" ON "PaymentAttempt"("createdAt");

CREATE INDEX "PaymentIntentEvent_paymentIntentId_createdAt_idx"
ON "PaymentIntentEvent"("paymentIntentId", "createdAt");
CREATE INDEX "PaymentIntentEvent_paymentAttemptId_createdAt_idx"
ON "PaymentIntentEvent"("paymentAttemptId", "createdAt");
CREATE INDEX "PaymentIntentEvent_type_idx" ON "PaymentIntentEvent"("type");
CREATE INDEX "PaymentIntentEvent_source_idx" ON "PaymentIntentEvent"("source");

-- Foreign keys
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_paymentIntentId_fkey"
FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentIntent"
ADD CONSTRAINT "PaymentIntent_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt"
ADD CONSTRAINT "PaymentAttempt_intentId_fkey"
FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentIntentEvent"
ADD CONSTRAINT "PaymentIntentEvent_paymentIntentId_fkey"
FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentIntentEvent"
ADD CONSTRAINT "PaymentIntentEvent_paymentAttemptId_fkey"
FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
