import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { ENV, ENV_DEFAULTS } from '../../../config/env.constants';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;
  private readonly fromName: string;
  private transporter: Transporter;
  private isEmailConfigured: boolean = false;

  constructor(private configService: ConfigService) {
    this.fromEmail =
      this.configService.get<string>(ENV.EMAIL_FROM) ?? ENV_DEFAULTS.EMAIL_FROM;
    this.fromName =
      this.configService.get<string>(ENV.EMAIL_FROM_NAME) ??
      ENV_DEFAULTS.EMAIL_FROM_NAME;
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const host = this.configService.get<string>(ENV.SMTP_HOST);
    const port = this.configService.get<number>(ENV.SMTP_PORT);
    const user = this.configService.get<string>(ENV.SMTP_USER);
    const pass = this.configService.get<string>(ENV.SMTP_PASSWORD);
    const secure = this.configService.get<boolean>(ENV.SMTP_SECURE) === true;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host: host,
        port: port ?? 587,
        secure: secure,
        auth: {
          user: user,
          pass: pass,
        },
        tls: {
          rejectUnauthorized:
            this.configService.get<string>(ENV.NODE_ENV) === 'production',
        },
      });
      this.isEmailConfigured = true;
      this.logger.log('Email service initialized with SMTP configuration');
    } else {
      this.transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
      this.isEmailConfigured = false;
      this.logger.warn(
        'Email service running in development mode - emails will be logged only',
      );
    }
  }

  private getFrontendUrl(): string {
    return (
      this.configService.get<string>(ENV.FRONTEND_URL) ??
      ENV_DEFAULTS.FRONTEND_URL
    );
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    const { to, subject, text, html, attachments } = options;

    this.logger.log(`Sending email to: ${to}, Subject: ${subject}`);

    const mailOptions = {
      from: `"${this.fromName}" <${this.fromEmail}>`,
      to,
      subject,
      text,
      html,
      attachments,
    };

    try {
      if (this.isEmailConfigured) {
        const info = await this.transporter.sendMail(mailOptions);
        this.logger.log(
          `Email sent successfully to ${to}, MessageId: ${info.messageId}`,
        );
        return true;
      } else {
        this.logger.log(`[DEV MODE] Email would be sent:`);
        this.logger.log(`  From: ${this.fromEmail}`);
        this.logger.log(`  To: ${to}`);
        this.logger.log(`  Subject: ${subject}`);
        if (html) {
          this.logger.debug(
            `  HTML Content preview: ${html.substring(0, 200)}...`,
          );
        }
        return true;
      }
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}:`, error);
      return false;
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.isEmailConfigured) {
      this.logger.warn('Cannot verify SMTP connection - not configured');
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully');
      return true;
    } catch (error) {
      this.logger.error('SMTP connection verification failed:', error);
      return false;
    }
  }

  async sendEnrollmentConfirmation(
    studentEmail: string,
    studentName: string,
    courseName: string,
    sectionNumber: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: studentEmail,
      subject: 'Enrollment Confirmed - CampusCore',
      text: `Dear ${studentName},

Your enrollment in ${courseName} (Section ${sectionNumber}) has been confirmed.

You can view your enrollments and schedule in the CampusCore portal.

Best regards,
CampusCore Administration`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="color: #1F2937; margin: 0 0 20px 0; font-size: 24px;">Enrollment Confirmed</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                Dear <strong style="color: #4F46E5;">${studentName}</strong>,
              </p>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                Your enrollment has been <strong style="color: #10B981;">successfully confirmed</strong> for the following course:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F9FAFB; border-radius: 8px; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Course</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${courseName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Section</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${sectionNumber}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="color: #4B5563; margin: 20px 0; font-size: 16px; line-height: 1.6;">
                You can now view your enrollments and schedule in the CampusCore portal.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);">
                    <a href="${this.getFrontendUrl()}/dashboard/enrollments" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">View My Enrollments</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }

  async sendPaymentConfirmation(
    studentEmail: string,
    studentName: string,
    invoiceNumber: string,
    amount: number,
  ): Promise<boolean> {
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);

    return this.sendEmail({
      to: studentEmail,
      subject: `Payment Received - Invoice ${invoiceNumber}`,
      text: `Dear ${studentName},

We have received your payment of ${formattedAmount} for invoice ${invoiceNumber}.

Thank you for your payment!

Best regards,
CampusCore Administration`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; background-color: #D1FAE5; border-radius: 50%;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
              <h2 style="color: #1F2937; margin: 0 0 10px 0; font-size: 24px; text-align: center;">Payment Received</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Dear <strong style="color: #4F46E5;">${studentName}</strong>,
              </p>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                We have received your payment. Thank you for your prompt payment!
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F9FAFB; border-radius: 8px; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Invoice Number</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${invoiceNumber}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Amount Paid</td>
                        <td style="padding: 8px 0; color: #10B981; font-size: 14px; font-weight: 600; text-align: right;">${formattedAmount}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Status</td>
                        <td style="padding: 8px 0; color: #10B981; font-size: 14px; font-weight: 600; text-align: right;">PAID</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }

  async sendInvoiceNotification(
    studentEmail: string,
    studentName: string,
    invoiceNumber: string,
    dueDate: string,
    amount: number,
  ): Promise<boolean> {
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);

    return this.sendEmail({
      to: studentEmail,
      subject: `New Invoice Available - ${invoiceNumber}`,
      text: `Dear ${studentName},

A new invoice (${invoiceNumber}) has been generated for you.

Amount: ${formattedAmount}
Due Date: ${dueDate}

Please log in to CampusCore to view and pay your invoice.

Best regards,
CampusCore Administration`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="color: #1F2937; margin: 0 0 20px 0; font-size: 24px;">New Invoice Available</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                Dear <strong style="color: #4F46E5;">${studentName}</strong>,
              </p>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                A new invoice has been generated for you. Please review and make your payment before the due date to avoid late fees.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #FEF3C7; border-radius: 8px; margin: 20px 0; border-left: 4px solid #F59E0B;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding: 8px 0; color: #92400E; font-size: 14px;">Invoice Number</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${invoiceNumber}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #92400E; font-size: 14px;">Amount Due</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${formattedAmount}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #92400E; font-size: 14px;">Due Date</td>
                        <td style="padding: 8px 0; color: #DC2626; font-size: 14px; font-weight: 600; text-align: right;">${dueDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);">
                    <a href="${this.getFrontendUrl()}/dashboard/invoices" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">Pay Invoice Now</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }

  async sendAnnouncementNotification(
    recipients: string[],
    title: string,
    content?: string,
  ): Promise<boolean> {
    const recipientList = recipients.join(',');

    return this.sendEmail({
      to: recipientList,
      subject: `New Announcement: ${title}`,
      text: `A new announcement "${title}" has been posted on CampusCore.${content ? `\n\n${content.substring(0, 200)}...` : ''}\n\nPlease log in to view the full details.`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; background-color: #E0E7FF; border-radius: 50%;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  </svg>
                </div>
              </div>
              <h2 style="color: #1F2937; margin: 0 0 10px 0; font-size: 24px; text-align: center;">New Announcement</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                A new announcement has been posted on CampusCore
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F9FAFB; border-radius: 8px; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="color: #1F2937; margin: 0 0 10px 0; font-size: 18px;">${title}</h3>
                    ${content ? `<p style="color: #4B5563; margin: 0; font-size: 14px; line-height: 1.6;">${content.substring(0, 200)}${content.length > 200 ? '...' : ''}</p>` : ''}
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);">
                    <a href="${this.getFrontendUrl()}/dashboard" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">View Announcement</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }

  async sendPasswordResetEmail(
    email: string,
    name: string,
    resetUrl: string,
  ): Promise<boolean> {
    const expiryMinutes =
      this.configService.get<number>(ENV.PASSWORD_RESET_EXPIRY_MINUTES) ??
      ENV_DEFAULTS.PASSWORD_RESET_EXPIRY_MINUTES;

    return this.sendEmail({
      to: email,
      subject: 'Password Reset Request - CampusCore',
      text: `You requested a password reset. Click the link below to reset your password:\n\n${resetUrl}\n\nThis link will expire in ${expiryMinutes} minutes.\n\nIf you did not request this, please ignore this email.`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; background-color: #FEE2E2; border-radius: 50%;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                </div>
              </div>
              <h2 style="color: #1F2937; margin: 0 0 10px 0; font-size: 24px; text-align: center;">Password Reset Request</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Dear <strong style="color: #4F46E5;">${name}</strong>,
              </p>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                You requested to reset your password. Click the button below to create a new password.
              </p>
              <div style="background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
                <p style="color: #92400E; margin: 0; font-size: 14px;">
                  This link will expire in <strong>${expiryMinutes} minutes</strong>.
                </p>
              </div>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="color: #9CA3AF; margin: 20px 0 0 0; font-size: 12px; text-align: center;">
                Or copy this link: ${resetUrl}
              </p>
              <div style="background-color: #FEE2E2; border-left: 4px solid #EF4444; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
                <p style="color: #991B1B; margin: 0; font-size: 14px;">
                  If you did not request this password reset, please ignore this email. Your password will remain unchanged.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }

  async sendWelcomeEmail(
    email: string,
    name: string,
    role: string,
    temporaryPassword?: string,
  ): Promise<boolean> {
    const loginLink = `${this.getFrontendUrl()}/login`;

    return this.sendEmail({
      to: email,
      subject: `Welcome to CampusCore - Your Account Has Been Created`,
      text: `Dear ${name},

Welcome to CampusCore! Your account has been successfully created.

Role: ${role}
${temporaryPassword ? `Temporary Password: ${temporaryPassword}\n` : ''}

Please log in at: ${loginLink}

Best regards,
CampusCore Administration`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; background-color: #D1FAE5; border-radius: 50%;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </div>
              </div>
              <h2 style="color: #1F2937; margin: 0 0 10px 0; font-size: 24px; text-align: center;">Welcome to CampusCore!</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Dear <strong style="color: #4F46E5;">${name}</strong>,
              </p>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Your account has been successfully created. You can now access the CampusCore academic management platform.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F9FAFB; border-radius: 8px; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Role</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${role}</td>
                      </tr>
                      ${
                        temporaryPassword
                          ? `
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Temporary Password</td>
                        <td style="padding: 8px 0; color: #EF4444; font-size: 14px; font-weight: 600; text-align: right;">${temporaryPassword}</td>
                      </tr>
                      `
                          : ''
                      }
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);">
                    <a href="${loginLink}" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">Login to CampusCore</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }

  async sendGradeNotification(
    studentEmail: string,
    studentName: string,
    courseName: string,
    sectionNumber: string,
    grade: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: studentEmail,
      subject: `Grade Posted - ${courseName}`,
      text: `Dear ${studentName},

Your grade for ${courseName} (Section ${sectionNumber}) has been posted.

Grade: ${grade}

You can view your complete academic transcript in the CampusCore portal.

Best regards,
CampusCore Administration`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; background-color: #E0E7FF; border-radius: 50%;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                </div>
              </div>
              <h2 style="color: #1F2937; margin: 0 0 10px 0; font-size: 24px; text-align: center;">Grade Posted</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Dear <strong style="color: #4F46E5;">${studentName}</strong>,
              </p>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Your grade for this semester has been posted.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F9FAFB; border-radius: 8px; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Course</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${courseName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Section</td>
                        <td style="padding: 8px 0; color: #1F2937; font-size: 14px; font-weight: 600; text-align: right;">${sectionNumber}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Grade</td>
                        <td style="padding: 8px 0; color: #4F46E5; font-size: 20px; font-weight: 700; text-align: right;">${grade}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);">
                    <a href="${this.getFrontendUrl()}/dashboard/grades" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">View My Grades</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }

  async sendVerificationEmail(
    email: string,
    name: string,
    verificationUrl: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Verify Your Email - CampusCore',
      text: `Dear ${name},

Welcome to CampusCore! Please verify your email address by clicking the link below:

${verificationUrl}

If you did not create an account, please ignore this email.

Best regards,
CampusCore Administration`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">CampusCore</h1>
              <p style="color: #E0E7FF; margin: 5px 0 0 0; font-size: 14px;">Academic Management Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; background-color: #D1FAE5; border-radius: 50%;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                </div>
              </div>
              <h2 style="color: #1F2937; margin: 0 0 10px 0; font-size: 24px; text-align: center;">Verify Your Email</h2>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Dear <strong style="color: #4F46E5;">${name}</strong>,
              </p>
              <p style="color: #4B5563; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; text-align: center;">
                Thank you for registering with CampusCore. Please verify your email address to activate your account.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);">
                    <a href="${verificationUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">Verify Email</a>
                  </td>
                </tr>
              </table>
              <p style="color: #9CA3AF; margin: 20px 0 0 0; font-size: 12px; text-align: center;">
                Or copy this link: ${verificationUrl}
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
  }
}
