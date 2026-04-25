import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { ENV, ENV_DEFAULTS } from '../../../config/env.constants';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EnrollmentEmailTemplate =
  | 'enrollment.confirmed'
  | 'enrollment.waitlisted'
  | 'enrollment.promoted'
  | 'enrollment.dropped';

export interface EnrollmentEmailOptions {
  to: string;
  template: EnrollmentEmailTemplate;
  locale?: 'en' | 'vi';
  studentName: string;
  courseCode?: string;
  courseName: string;
  courseNameVi?: string;
  sectionNumber: string;
  semesterName?: string;
  semesterNameVi?: string;
  link?: string | null;
}

type EnrollmentCopy = {
  subjectPrefix: string;
  title: string;
  greeting: string;
  body: (course: string, section: string, semester?: string) => string;
  ctaText: string;
  ctaLabel: string;
  signoff: string;
};

type EnrollmentCopyKey = 'confirmed' | 'waitlisted' | 'promoted' | 'dropped';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly configured: boolean;
  private readonly transporter: Transporter;

  constructor(private readonly configService: ConfigService) {
    this.fromEmail =
      this.configService.get<string>(ENV.EMAIL_FROM) ?? ENV_DEFAULTS.EMAIL_FROM;
    this.fromName =
      this.configService.get<string>(ENV.EMAIL_FROM_NAME) ??
      ENV_DEFAULTS.EMAIL_FROM_NAME;

    const host = this.configService.get<string>(ENV.SMTP_HOST);
    const port = this.configService.get<number>(ENV.SMTP_PORT) ?? 587;
    const user = this.configService.get<string>(ENV.SMTP_USER);
    const password = this.configService.get<string>(ENV.SMTP_PASSWORD);
    const secure = this.configService.get<boolean>(ENV.SMTP_SECURE) === true;

    this.configured = Boolean(host);
    this.transporter = this.configured
      ? nodemailer.createTransport({
          host,
          port,
          secure,
          ...(user && password
            ? {
                auth: {
                  user,
                  pass: password,
                },
              }
            : {}),
        })
      : nodemailer.createTransport({ jsonTransport: true });

    this.logger.log(
      this.configured
        ? 'Email service initialized with SMTP transport'
        : 'Email service initialized with JSON transport',
    );
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      this.logger.log(
        `Email delivery accepted for ${options.to}; messageId=${
          info.messageId ?? 'json-transport'
        }`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Email delivery failed for ${options.to}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return false;
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.configured) {
      this.logger.warn(
        'SMTP connection verification skipped; SMTP is not configured',
      );
      return false;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.warn(
        `SMTP connection verification failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return false;
    }
  }

  async sendEnrollmentNotification(
    options: EnrollmentEmailOptions,
  ): Promise<boolean> {
    const locale = options.locale === 'vi' ? 'vi' : 'en';
    const courseName =
      locale === 'vi'
        ? (options.courseNameVi ?? options.courseName)
        : options.courseName;
    const courseLabel = options.courseCode
      ? `${options.courseCode} - ${courseName}`
      : courseName;
    const semesterName =
      locale === 'vi'
        ? (options.semesterNameVi ?? options.semesterName)
        : options.semesterName;
    const targetPath = options.link ?? '/dashboard/enrollments';
    const targetUrl = this.safeUrl(`${this.getFrontendUrl()}${targetPath}`);

    const copy = this.getEnrollmentCopy(locale, options.template);
    const subject = `${copy.subjectPrefix}: ${courseLabel}`;
    const text = [
      `${copy.greeting} ${options.studentName},`,
      '',
      copy.body(courseLabel, options.sectionNumber, semesterName),
      '',
      copy.ctaText,
      targetUrl,
      '',
      copy.signoff,
      'CampusCore Administration',
    ].join('\n');

    const html = this.renderEnrollmentHtml({
      title: copy.title,
      greeting: `${copy.greeting} ${this.escapeHtml(options.studentName)},`,
      body: copy.body(
        this.escapeHtml(courseLabel),
        this.escapeHtml(options.sectionNumber),
        semesterName ? this.escapeHtml(semesterName) : undefined,
      ),
      ctaLabel: copy.ctaLabel,
      targetUrl,
    });

    return this.sendEmail({
      to: options.to,
      subject,
      text,
      html,
    });
  }

  private getEnrollmentCopy(
    locale: 'en' | 'vi',
    template: EnrollmentEmailTemplate,
  ) {
    const copyKey = this.getEnrollmentCopyKey(template);
    const dictionaries: Record<
      'en' | 'vi',
      Record<EnrollmentCopyKey, EnrollmentCopy>
    > = {
      vi: {
        confirmed: {
          subjectPrefix: 'Đăng ký học phần đã được ghi nhận',
          title: 'Đăng ký học phần đã được ghi nhận',
          greeting: 'Xin chào',
          body: (course: string, section: string, semester?: string) =>
            `Bạn đã đăng ký ${course}, lớp học phần ${section}${
              semester ? ` cho ${semester}` : ''
            }. Hãy kiểm tra lịch học và các thông báo liên quan trong CampusCore.`,
          ctaText: 'Mở trang môn học của tôi:',
          ctaLabel: 'Xem môn học của tôi',
          signoff: 'Trân trọng,',
        },
        waitlisted: {
          subjectPrefix: 'Bạn đã vào danh sách chờ',
          title: 'Bạn đã vào danh sách chờ',
          greeting: 'Xin chào',
          body: (course: string, section: string, semester?: string) =>
            `${course}, lớp học phần ${section}${
              semester ? ` trong ${semester}` : ''
            } hiện chưa còn chỗ. CampusCore đã ghi nhận bạn vào danh sách chờ.`,
          ctaText: 'Theo dõi trạng thái đăng ký:',
          ctaLabel: 'Theo dõi đăng ký',
          signoff: 'Trân trọng,',
        },
        promoted: {
          subjectPrefix: 'Bạn đã được chuyển từ danh sách chờ',
          title: 'Bạn đã được chuyển từ danh sách chờ',
          greeting: 'Xin chào',
          body: (course: string, section: string, semester?: string) =>
            `Một chỗ đã mở cho ${course}, lớp học phần ${section}${
              semester ? ` trong ${semester}` : ''
            }. CampusCore đã chuyển bạn sang trạng thái đăng ký.`,
          ctaText: 'Kiểm tra lịch học mới:',
          ctaLabel: 'Mở thời khóa biểu',
          signoff: 'Trân trọng,',
        },
        dropped: {
          subjectPrefix: 'Đã rút khỏi học phần',
          title: 'Đã rút khỏi học phần',
          greeting: 'Xin chào',
          body: (course: string, section: string, semester?: string) =>
            `Bạn đã rút khỏi ${course}, lớp học phần ${section}${
              semester ? ` trong ${semester}` : ''
            }. Hãy kiểm tra lại thời khóa biểu và số tín chỉ hiện tại trong CampusCore.`,
          ctaText: 'Kiểm tra môn học của tôi:',
          ctaLabel: 'Xem môn học của tôi',
          signoff: 'Trân trọng,',
        },
      },
      en: {
        confirmed: {
          subjectPrefix: 'Enrollment recorded',
          title: 'Enrollment recorded',
          greeting: 'Hello',
          body: (course: string, section: string, semester?: string) =>
            `Your enrollment for ${course}, section ${section}${
              semester ? ` in ${semester}` : ''
            }, has been recorded. Please review your schedule and related notices in CampusCore.`,
          ctaText: 'Open your course list:',
          ctaLabel: 'View my courses',
          signoff: 'Best regards,',
        },
        waitlisted: {
          subjectPrefix: 'You joined the waitlist',
          title: 'You joined the waitlist',
          greeting: 'Hello',
          body: (course: string, section: string, semester?: string) =>
            `${course}, section ${section}${
              semester ? ` in ${semester}` : ''
            }, is currently full. CampusCore has recorded your waitlist request.`,
          ctaText: 'Track your registration status:',
          ctaLabel: 'Track registration',
          signoff: 'Best regards,',
        },
        promoted: {
          subjectPrefix: 'Waitlist seat opened',
          title: 'Waitlist seat opened',
          greeting: 'Hello',
          body: (course: string, section: string, semester?: string) =>
            `A seat opened for ${course}, section ${section}${
              semester ? ` in ${semester}` : ''
            }. CampusCore has moved you into the enrollment queue.`,
          ctaText: 'Review your updated schedule:',
          ctaLabel: 'Open schedule',
          signoff: 'Best regards,',
        },
        dropped: {
          subjectPrefix: 'Course dropped',
          title: 'Course dropped',
          greeting: 'Hello',
          body: (course: string, section: string, semester?: string) =>
            `You have dropped ${course}, section ${section}${
              semester ? ` in ${semester}` : ''
            }. Please review your schedule and current credit load in CampusCore.`,
          ctaText: 'Review your course list:',
          ctaLabel: 'View my courses',
          signoff: 'Best regards,',
        },
      },
    };

    return dictionaries[locale][copyKey];
  }

  private getEnrollmentCopyKey(
    template: EnrollmentEmailTemplate,
  ): EnrollmentCopyKey {
    if (template === 'enrollment.waitlisted') {
      return 'waitlisted';
    }
    if (template === 'enrollment.promoted') {
      return 'promoted';
    }
    if (template === 'enrollment.dropped') {
      return 'dropped';
    }
    return 'confirmed';
  }

  private renderEnrollmentHtml(input: {
    title: string;
    greeting: string;
    body: string;
    ctaLabel: string;
    targetUrl: string;
  }) {
    return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f3ef;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e0d8;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#172033;color:#ffffff;padding:24px 28px;">
                <div style="font-size:22px;font-weight:700;">CampusCore</div>
                <div style="font-size:13px;color:#c8d2e0;margin-top:4px;">Campus operations workspace</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">${this.escapeHtml(input.title)}</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.7;">${input.greeting}</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">${input.body}</p>
                <a href="${input.targetUrl}" style="display:inline-block;background:#172033;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">${this.escapeHtml(input.ctaLabel)}</a>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;color:#64748b;padding:18px 28px;font-size:12px;">
                © ${new Date().getFullYear()} CampusCore. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  private getFrontendUrl() {
    return (
      this.configService.get<string>(ENV.FRONTEND_URL) ??
      ENV_DEFAULTS.FRONTEND_URL
    ).replace(/\/$/u, '');
  }

  private safeUrl(url: string) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '#';
      }
      return this.escapeHtml(parsed.toString());
    } catch {
      return '#';
    }
  }

  private escapeHtml(value: string | number | null | undefined) {
    if (value === null || value === undefined) {
      return '';
    }

    return String(value)
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;')
      .replace(/'/gu, '&#39;');
  }
}
