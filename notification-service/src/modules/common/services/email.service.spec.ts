import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';
import { ENV, ENV_DEFAULTS } from '../../../config/env.constants';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('EmailService', () => {
  const sendMail = jest.fn();
  const verify = jest.fn();
  const configWithFrontendUrl = {
    get: jest.fn((key: string) => {
      if (key === ENV.FRONTEND_URL) {
        return 'https://tienson.io.vn';
      }
      return undefined;
    }),
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail,
      verify,
    });
    sendMail.mockResolvedValue({ messageId: 'message-1' });
    verify.mockResolvedValue(true);
  });

  it('renders an English enrollment confirmation email by default', async () => {
    const service = new EmailService(configWithFrontendUrl);

    const result = await service.sendEnrollmentNotification({
      to: 'student@example.edu',
      template: 'enrollment.confirmed',
      studentName: 'Ava Nguyen',
      courseCode: 'CS301',
      courseName: 'Distributed Systems',
      courseNameVi: 'Hệ thống phân tán',
      sectionNumber: 'A1',
      semesterName: 'Spring 2025',
      semesterNameVi: 'Học kỳ Xuân 2025',
      link: '/dashboard/enrollments',
    });

    expect(result).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: `"${ENV_DEFAULTS.EMAIL_FROM_NAME}" <${ENV_DEFAULTS.EMAIL_FROM}>`,
        to: 'student@example.edu',
        subject: expect.stringContaining('Enrollment recorded'),
        text: expect.stringContaining('Distributed Systems'),
        html: expect.stringContaining('Enrollment recorded'),
      }),
    );
  });

  it('renders a Vietnamese enrollment waitlist email without mojibake', async () => {
    const service = new EmailService(configWithFrontendUrl);

    const result = await service.sendEnrollmentNotification({
      to: 'student@example.edu',
      template: 'enrollment.waitlisted',
      locale: 'vi',
      studentName: 'Ava Nguyen',
      courseCode: 'CS301',
      courseName: 'Distributed Systems',
      courseNameVi: 'Hệ thống phân tán',
      sectionNumber: 'A1',
      semesterName: 'Spring 2025',
      semesterNameVi: 'Học kỳ Xuân 2025',
      link: '/vi/dashboard/register',
    });

    expect(result).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: `"${ENV_DEFAULTS.EMAIL_FROM_NAME}" <${ENV_DEFAULTS.EMAIL_FROM}>`,
        to: 'student@example.edu',
        subject: expect.stringContaining('Bạn đã vào danh sách chờ'),
        text: expect.stringContaining('Hệ thống phân tán'),
        html: expect.stringContaining('Bạn đã vào danh sách chờ'),
      }),
    );
  });

  it('uses SMTP transport when server-side SMTP secrets are configured', () => {
    new EmailService({
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          [ENV.SMTP_HOST]: 'smtp.gmail.com',
          [ENV.SMTP_PORT]: 587,
          [ENV.SMTP_SECURE]: false,
          [ENV.SMTP_USER]: 'sender@example.com',
          [ENV.SMTP_PASSWORD]: 'private-app-password',
        };
        return values[key];
      }),
    } as never);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: 'sender@example.com',
          pass: 'private-app-password',
        },
      }),
    );
  });

  it('uses unauthenticated SMTP transport for local MailHog', () => {
    new EmailService({
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          [ENV.SMTP_HOST]: 'mailhog',
          [ENV.SMTP_PORT]: 1025,
          [ENV.SMTP_SECURE]: false,
        };
        return values[key];
      }),
    } as never);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mailhog',
        port: 1025,
        secure: false,
      }),
    );
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.not.objectContaining({
        auth: expect.anything(),
      }),
    );
  });
});
