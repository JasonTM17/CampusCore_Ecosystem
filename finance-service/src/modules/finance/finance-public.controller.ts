import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { FinanceService } from './finance.service';
import { ProviderSignalDto } from './dto/provider-signal.dto';
import { SandboxPaymentSignalStatus } from './payment-orchestration.util';

@ApiTags('Finance')
@Controller('finance/payment-providers')
export class FinancePublicController {
  constructor(private readonly financeService: FinanceService) {}

  @Get(':provider/handoff/:token')
  @ApiOperation({
    summary: 'Render sandbox handoff page for provider checkout',
  })
  async renderProviderHandoff(
    @Param('provider') provider: string,
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    const handoff = await this.financeService.getSandboxProviderHandoff(
      provider,
      token,
    );

    const locale = handoff.locale;
    const copy =
      locale === 'vi'
        ? {
            title: `Thanh toán qua ${handoff.providerLabel.vi}`,
            eyebrow: 'Cổng thanh toán sandbox',
            description:
              'Đây là màn xác nhận checkout an toàn để mô phỏng bước nhà cung cấp trước khi quay lại CampusCore.',
            invoice: 'Hóa đơn',
            semester: 'Học kỳ',
            amount: 'Giá trị xử lý',
            expiresAt: 'Hết hạn lúc',
            complete: 'Hoàn tất thanh toán',
            processing: 'Đánh dấu đang xử lý',
            fail: 'Từ chối thanh toán',
            cancel: 'Hủy và quay lại',
            back: 'Quay lại hóa đơn',
          }
        : {
            title: `${handoff.providerLabel.en} checkout`,
            eyebrow: 'Sandbox payment handoff',
            description:
              'This safe verification page simulates the provider step before returning the learner to CampusCore.',
            invoice: 'Invoice',
            semester: 'Semester',
            amount: 'Amount in flow',
            expiresAt: 'Expires at',
            complete: 'Complete payment',
            processing: 'Mark processing',
            fail: 'Decline payment',
            cancel: 'Cancel and return',
            back: 'Return to invoice',
          };

    const actionUrl = (status: SandboxPaymentSignalStatus) =>
      `/api/v1/finance/payment-providers/${provider}/handoff/${token}/complete?status=${status}`;

    const qrMarkup = handoff.nextAction.qrPayload
      ? `<div class="meta-card"><div class="meta-label">QR payload</div><code>${handoff.nextAction.qrPayload}</code></div>`
      : '';
    const deeplinkMarkup = handoff.nextAction.deeplinkUrl
      ? `<div class="meta-card"><div class="meta-label">Deeplink</div><code>${handoff.nextAction.deeplinkUrl}</code></div>`
      : '';

    res.status(200).type('html').send(`<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${copy.title}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f1720;
        color: #f8fafc;
        display: grid;
        place-items: center;
        padding: 32px 20px;
      }
      .shell {
        width: min(720px, 100%);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(15, 23, 32, 0.96), rgba(24, 33, 47, 0.98));
        box-shadow: 0 28px 70px rgba(15, 23, 32, 0.32);
        overflow: hidden;
      }
      .content { padding: 28px; }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #f59e0b;
        margin-bottom: 14px;
      }
      h1 { margin: 0; font-size: clamp(30px, 4vw, 44px); line-height: 1.1; }
      p { color: #cbd5e1; line-height: 1.7; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin: 22px 0 16px;
      }
      .meta-card {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 14px;
        padding: 14px 16px;
        background: rgba(15, 23, 32, 0.55);
      }
      .meta-label {
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #94a3b8;
        margin-bottom: 8px;
      }
      .meta-value {
        font-size: 16px;
        font-weight: 600;
      }
      code {
        display: inline-block;
        max-width: 100%;
        overflow-wrap: anywhere;
        font-size: 13px;
        color: #e2e8f0;
      }
      .actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        font-weight: 600;
        text-decoration: none;
      }
      .button-primary { background: #7dd3fc; color: #0f1720; border-color: transparent; }
      .button-secondary { background: rgba(148, 163, 184, 0.14); color: #f8fafc; }
      .button-danger { background: rgba(239, 68, 68, 0.14); color: #fecaca; }
      .button-outline { background: transparent; color: #f8fafc; }
      .footer {
        padding: 18px 28px 24px;
        border-top: 1px solid rgba(148, 163, 184, 0.12);
        display: flex;
        justify-content: flex-end;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="content">
        <div class="eyebrow">${copy.eyebrow}</div>
        <h1>${copy.title}</h1>
        <p>${copy.description}</p>
        <section class="grid">
          <div class="meta-card">
            <div class="meta-label">${copy.invoice}</div>
            <div class="meta-value">${handoff.invoiceNumber}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">${copy.semester}</div>
            <div class="meta-value">${
              locale === 'vi'
                ? handoff.semesterNameVi || handoff.semesterName
                : handoff.semesterNameEn || handoff.semesterName
            }</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">${copy.amount}</div>
            <div class="meta-value">${new Intl.NumberFormat(
              locale === 'vi' ? 'vi-VN' : 'en-US',
              {
                style: 'currency',
                currency: handoff.currency,
                maximumFractionDigits: 0,
              },
            ).format(handoff.amount)}</div>
          </div>
          ${
            handoff.expiresAt
              ? `<div class="meta-card"><div class="meta-label">${copy.expiresAt}</div><div class="meta-value">${new Intl.DateTimeFormat(
                  locale === 'vi' ? 'vi-VN' : 'en-US',
                  {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  },
                ).format(new Date(handoff.expiresAt))}</div></div>`
              : ''
          }
          ${qrMarkup}
          ${deeplinkMarkup}
        </section>

        <section class="actions">
          <a class="button button-primary" href="${actionUrl(
            SandboxPaymentSignalStatus.SUCCESS,
          )}">${copy.complete}</a>
          <a class="button button-secondary" href="${actionUrl(
            SandboxPaymentSignalStatus.PROCESSING,
          )}">${copy.processing}</a>
          <a class="button button-danger" href="${actionUrl(
            SandboxPaymentSignalStatus.FAILED,
          )}">${copy.fail}</a>
          <a class="button button-outline" href="${actionUrl(
            SandboxPaymentSignalStatus.CANCELLED,
          )}">${copy.cancel}</a>
        </section>
      </div>
      <div class="footer">
        <a class="button button-outline" href="${actionUrl(
          SandboxPaymentSignalStatus.CANCELLED,
        )}">${copy.back}</a>
      </div>
    </main>
  </body>
</html>`);
  }

  @Get(':provider/handoff/:token/complete')
  @ApiOperation({
    summary: 'Complete sandbox handoff and return to the student invoice flow',
  })
  async completeProviderHandoff(
    @Param('provider') provider: string,
    @Param('token') token: string,
    @Query('status') status: SandboxPaymentSignalStatus,
    @Res() res: Response,
  ) {
    const nextStatus = Object.values(SandboxPaymentSignalStatus).includes(
      status as SandboxPaymentSignalStatus,
    )
      ? status
      : SandboxPaymentSignalStatus.CANCELLED;
    const redirectUrl =
      await this.financeService.completeSandboxProviderHandoff(
        provider,
        token,
        nextStatus,
      );

    res.redirect(303, redirectUrl);
  }

  @Post(':provider/callback/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sandbox callback verification stub for providers' })
  handleProviderCallback(
    @Param('provider') provider: string,
    @Param('token') token: string,
    @Body() signal: ProviderSignalDto,
  ) {
    return this.financeService.handlePaymentProviderCallback(
      provider,
      token,
      signal,
    );
  }

  @Post(':provider/webhook/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sandbox webhook verification stub for providers' })
  handleProviderWebhook(
    @Param('provider') provider: string,
    @Param('token') token: string,
    @Body() signal: ProviderSignalDto,
  ) {
    return this.financeService.handlePaymentProviderWebhook(
      provider,
      token,
      signal,
    );
  }
}
