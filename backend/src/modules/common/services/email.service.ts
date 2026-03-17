import { Injectable, Logger } from '@nestjs/common';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail = process.env.EMAIL_FROM || 'noreply@campuscore.edu';

  async sendEmail(options: EmailOptions): Promise<boolean> {
    const { to, subject, text, html } = options;

    // Log email for development (actual email sending would require SMTP config)
    this.logger.log(`Sending email to: ${to}`);
    this.logger.log(`Subject: ${subject}`);
    this.logger.log(`From: ${this.fromEmail}`);

    // In production, integrate with SMTP service (e.g., SendGrid, Mailgun, AWS SES)
    // For now, we'll log the email content
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(`Email content: ${text || html?.substring(0, 100)}...`);
    }

    // TODO: Implement actual email sending with SMTP
    // Example with SendGrid:
    // await this.sendGrid.send({
    //   to,
    //   from: this.fromEmail,
    //   subject,
    //   text,
    //   html,
    // });

    return true;
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
      text: `Dear ${studentName},\n\nYour enrollment in ${courseName} (Section ${sectionNumber}) has been confirmed.\n\nBest regards,\nCampusCore Administration`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Enrollment Confirmed</h2>
          <p>Dear <strong>${studentName}</strong>,</p>
          <p>Your enrollment in <strong>${courseName}</strong> (Section ${sectionNumber}) has been confirmed.</p>
          <p>You can view your enrollments and schedule in the CampusCore portal.</p>
          <p>Best regards,<br/>CampusCore Administration</p>
        </div>
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
      text: `Dear ${studentName},\n\nWe have received your payment of ${formattedAmount} for invoice ${invoiceNumber}.\n\nBest regards,\nCampusCore Administration`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Payment Received</h2>
          <p>Dear <strong>${studentName}</strong>,</p>
          <p>We have received your payment of <strong>${formattedAmount}</strong> for invoice <strong>${invoiceNumber}</strong>.</p>
          <p>Thank you for your payment!</p>
          <p>Best regards,<br/>CampusCore Administration</p>
        </div>
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
      text: `Dear ${studentName},\n\nA new invoice (${invoiceNumber}) has been generated for you.\n\nAmount: ${formattedAmount}\nDue Date: ${dueDate}\n\nPlease log in to CampusCore to view and pay your invoice.\n\nBest regards,\nCampusCore Administration`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>New Invoice Available</h2>
          <p>Dear <strong>${studentName}</strong>,</p>
          <p>A new invoice has been generated for you:</p>
          <ul>
            <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
            <li><strong>Amount:</strong> ${formattedAmount}</li>
            <li><strong>Due Date:</strong> ${dueDate}</li>
          </ul>
          <p>Please log in to CampusCore to view and pay your invoice.</p>
          <p>Best regards,<br/>CampusCore Administration</p>
        </div>
      `,
    });
  }

  async sendAnnouncementNotification(
    recipients: string[],
    title: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: recipients.join(','),
      subject: `New Announcement: ${title}`,
      text: `A new announcement "${title}" has been posted on CampusCore. Please log in to view the full details.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>New Announcement</h2>
          <p>A new announcement "<strong>${title}</strong>" has been posted on CampusCore.</p>
          <p>Please log in to view the full details.</p>
        </div>
      `,
    });
  }

  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
  ): Promise<boolean> {
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password?token=${resetToken}`;

    return this.sendEmail({
      to: email,
      subject: 'Password Reset Request - CampusCore',
      text: `You requested a password reset. Click the link below to reset your password:\n\n${resetLink}\n\nIf you did not request this, please ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>You requested a password reset. Click the button below to reset your password:</p>
          <p style="margin: 20px 0;">
            <a href="${resetLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Reset Password</a>
          </p>
          <p>Or copy this link: ${resetLink}</p>
          <p>If you did not request this, please ignore this email.</p>
        </div>
      `,
    });
  }
}
