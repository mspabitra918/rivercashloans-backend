import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { ApplicationStatus, BRAND } from '../common/constants';
import { formatPacificDateTime } from '../common/timezone';

// Shape consumed by sendApplicationConfirmationEmail. Kept local because the
// confirmation template uses snake_case fields that don't map 1:1 to the
// Sequelize Application model (which is camelCase).
interface LoanApplication {
  id: string;
  application_id: string;
  first_name: string;
  last_name: string;
  email: string;
  loan_amount: number;
  loan_term: number;
}

export interface EmailAttachment {
  filename: string;
  data: Buffer;
  contentType?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  attachment?: EmailAttachment[];
}
interface StatusUpdateDetails {
  applicationId: string;
  firstName: string;
  email: string;
  loanAmount: number;
  status: ApplicationStatus;
  last_name: string;
  id: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  // constructor(private readonly config: ConfigService) {
  //   const mailgun = new Mailgun(FormData);
  //   this.mailgun = mailgun.client({
  //     username: 'api',
  //     key: this.config.get<string>('MAILGUN_API_KEY') ?? '',
  //   });
  //   this.domain = this.config.get<string>('MAILGUN_DOMAIN') ?? '';
  // }
  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.config.get<string>('USER_MAIL'),
        pass: this.config.get<string>('USER_PASSWORD'),
      },
    });
  }

  // private async sendMailgunEmail(payload: EmailPayload): Promise<void> {
  //   try {
  //     const message: Record<string, any> = {
  //       from: this.config.get<string>(
  //         'MAILGUN_FROM',
  //         'Oakhill Loans <noreply@oakhillloans.com>',
  //       ),
  //       to: payload.to,
  //       subject: payload.subject,
  //       html: payload.html,
  //     };

  //     // Mailgun.js takes attachments as { filename, data } objects (data may be
  //     // a Buffer). Only set the field when files are actually present.
  //     if (payload.attachment?.length) {
  //       message.attachment = payload.attachment.map((a) => ({
  //         filename: a.filename,
  //         data: a.data,
  //         contentType: a.contentType,
  //       }));
  //     }

  //     await this.mailgun.messages.create(this.domain, message);
  //     this.logger.log(`Email sent to ${payload.to}: ${payload.subject}`);
  //   } catch (err) {
  //     this.logger.error(`Failed to send email to ${payload.to}`, err);
  //   }
  // }

  private async sendEmail(payload: EmailPayload): Promise<void> {
    try {
      const fromAddress = this.config.get<string>('USER_MAIL');
      await this.transporter.sendMail({
        from: fromAddress
          ? `"${BRAND.fromName}" <${fromAddress}>`
          : BRAND.supportEmail,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        attachments: payload.attachment?.map((a) => ({
          filename: a.filename,
          content: a.data,
          contentType: a.contentType,
        })),
      });

      this.logger.log(`Email sent to ${payload.to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${payload.to}`, error);
    }
  }

  async sendOtpEmail(
    email: string,
    otp: string,
    expiryMinutes: number,
  ): Promise<void> {
    const html = `
      <p>Your OTP is <strong>${otp}</strong>. It is valid for ${expiryMinutes} minutes.</p>
    `;
    await this.sendEmail({
      to: email,
      subject: 'Your OTP',
      html,
    });
  }

  // ── App-facing notifications ─────────────────────────────────
  // These are the methods the rest of the app calls (applications,
  // gatekeeper, underwriting). Each only has the recipient's email and first
  // name to work with, so they send a self-contained, branded message.

  // private get portalUrl(): string {
  //   return `${process.env.FRONTEND_URL ?? ''}/dashboard/id=${id}`;
  // }

  // Confirmation right after an application is submitted.
  async applicationReceived(
    email: string,
    firstName: string,
    id: string,
  ): Promise<void> {
    const html = this.simpleLayout({
      heading: 'Application Received',
      color: '#1a56db',
      icon: '&#127974;', // 🏦
      bodyHtml: `
        <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
        <p style="color: #374151; font-size: 16px;">
          Thank you for applying with ${BRAND.name}. We've received your
          application and our team is reviewing it now. We'll be in touch with
          your next steps shortly.
        </p>`,
      cta: {
        label: 'Check Your Application Status',
        url: `${process.env.FRONTEND_URL ?? ''}/dashboard?id=${id}`,
      },
    });
    await this.sendEmail({
      to: email,
      subject: `We received your application | ${BRAND.name}`,
      html,
    });
  }

  async loanAgreementSigned(
    email: string,
    firstName: string,
    id: string,
  ): Promise<void> {
    const html = this.simpleLayout({
      heading: 'Loan Agreement Signed',
      color: '#16a34a',
      icon: '&#9997;', // ✍️
      bodyHtml: `
      <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>

      <p style="color: #374151; font-size: 16px;">
        Thank you for electronically signing your loan agreement.
        We have successfully received your signature.
      </p>

      <p style="color: #374151; font-size: 16px;">
        Our team will review your signed agreement and release your funds. No
        further action is needed right now — we'll notify you as soon as there
        is an update.
      </p>

      <p style="color: #374151; font-size: 16px;">
        Thank you for choosing ${BRAND.name}.
      </p>
    `,
      cta: {
        label: 'View Application Status',
        url: `${process.env.FRONTEND_URL ?? ''}/dashboard?id=${id}`,
      },
    });

    await this.sendEmail({
      to: email,
      subject: `Loan Agreement Signed Successfully | ${BRAND.name}`,
      html,
    });
  }

  // Adverse-action notice when an application is declined.
  async declined(email: string, firstName: string): Promise<void> {
    const html = this.simpleLayout({
      heading: 'Application Update',
      color: '#dc2626',
      icon: '&#10060;', // ❌
      bodyHtml: `
        <p style="color: #374151; font-size: 16px;">Dear ${firstName},</p>
        <p style="color: #374151; font-size: 16px;">
          Thank you for your recent application with ${BRAND.name}. After careful
          review, we are unable to approve your request for credit at this time.
        </p>
        <p style="color: #374151; font-size: 14px;">
          You have the right to a statement of the specific reasons for this
          decision. To obtain it, contact us within 60 days at the phone number
          below and we will provide the statement within 30 days.
        </p>`,
    });
    await this.sendEmail({
      to: email,
      subject: `An update on your application | ${BRAND.name}`,
      html,
    });
  }

  // Sent when bank details can't be verified and must be re-submitted.
  async bankCorrection(
    email: string,
    firstName: string,
    id: string,
  ): Promise<void> {
    const html = this.simpleLayout({
      heading: 'Action Needed: Update Your Bank Details',
      color: '#f59e0b',
      icon: '&#127974;', // 🏦
      bodyHtml: `
        <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
        <p style="color: #374151; font-size: 16px;">
          We weren't able to verify the bank account details you provided. To
          keep your application moving, please sign in and re-enter your bank
          information so we can complete verification.
        </p>`,
      cta: {
        label: 'Update Bank Details',
        url: `${process.env.FRONTEND_URL ?? ''}/dashboard?id=${id}&bankModalOpen=open`,
      },
    });
    await this.sendEmail({
      to: email,
      subject: `Action needed: confirm your bank details | ${BRAND.name}`,
      html,
    });
  }

  // Sent when an application is approved and moves toward funding.
  async loanApproved(
    email: string,
    firstName: string,
    id: string,
  ): Promise<void> {
    const html = this.simpleLayout({
      heading: 'Your Loan Is Approved!',
      color: '#16a34a',
      icon: '&#9989;', // ✅
      bodyHtml: `
        <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
        <p style="color: #374151; font-size: 16px;">
          Great news! Your loan application has been approved. Sign in to review
          your next steps and complete the final verification so we can release
          your funds.
        </p>`,
      cta: {
        label: 'View Next Steps',
        url: `${process.env.FRONTEND_URL ?? ''}/dashboard?id=${id}`,
      },
    });
    await this.sendEmail({
      to: email,
      subject: `Good news — your loan is approved! | ${BRAND.name}`,
      html,
    });
  }

  // Sent when funds are released.
  async funded(email: string, firstName: string): Promise<void> {
    const html = this.simpleLayout({
      heading: 'Loan Funded!',
      color: '#16a34a',
      icon: '&#128176;', // 💰
      bodyHtml: `
        <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
        <p style="color: #374151; font-size: 16px;">
          Your loan has been fully approved and finalized. The funds are on their
          way and will be deposited into your registered bank account within the
          next 24 hours (exact availability depends on your bank's standard
          processing times).
        </p>
        <p style="color: #374151; font-size: 16px;">
          If you do not see the funds after 24 hours, please call us at
          <strong>${BRAND.phone}</strong>.
        </p>`,
    });
    await this.sendEmail({
      to: email,
      subject: `Your loan has been funded! | ${BRAND.name}`,
      html,
    });
  }

  // Branded shell shared by the app-facing notifications above.
  private simpleLayout(opts: {
    heading: string;
    color: string;
    icon: string;
    bodyHtml: string;
    cta?: { label: string; url: string };
  }): string {
    const ctaHtml = opts.cta
      ? `<div style="text-align: center; margin: 25px 0;">
          <a href="${opts.cta.url}" style="background: ${opts.color}; color: #ffffff; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block;">${opts.cta.label}</a>
        </div>`
      : '';
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #FFFFFF; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; border: 1px solid #e5e7eb;">
        <img src="${BRAND.logoUrl}" alt="${BRAND.name}" style="height: 48px; width: 200px; display: block; margin: 0 auto 8px; color: #1a56db; font-size: 20px; font-weight: bold; line-height: 48px;" />
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 8px 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span style="font-size: 48px;">${opts.icon}</span>
        </div>
        <h2 style="color: ${opts.color}; margin-top: 0; text-align: center;">${opts.heading}</h2>
        ${opts.bodyHtml}
        ${ctaHtml}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <div style="text-align: center; padding: 10px 0;">
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Phone:</strong> <a href="tel:${BRAND.phoneTel}" style="color: #1a56db; text-decoration: none;">${BRAND.phone}</a>
          </p>
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Website:</strong> <a href="${BRAND.website}" style="color: #1a56db; text-decoration: none;">${BRAND.websiteLabel}</a>
          </p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated email from ${BRAND.name}. Please do not reply to this email.
        </p>
      </div>
    </div>`;
  }

  // ── New Loan Application Alert to Admin ───────────────────────
  async sendApplicationConfirmationEmail(
    details: LoanApplication,
  ): Promise<void> {
    const {
      id,
      application_id,
      first_name,
      last_name,
      email,
      loan_amount,
      loan_term,
      //   loan_purpose,
    } = details;

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(loan_amount);

    // const purposeLabel = loan_purpose
    //   .replace(/-/g, ' ')
    //   .replace(/\b\w/g, (c) => c.toUpperCase());

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
     <div style="background: #FFFFFF; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb;">
        <img src="${BRAND.logoUrl}" alt="${BRAND.name}" style="height: 48px; width: 200px; display: block; margin: 0 auto 8px; color: #1a56db; font-size: 20px; font-weight: bold; line-height: 48px;" />
    </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #111827; margin-top: 0;">Application Received!</h2>
        <p style="color: #374151; font-size: 16px;">
          Hi ${first_name},
        </p>
        <p style="color: #374151; font-size: 16px;">
          Thank you for submitting your loan application. We have received your application and it is now being processed.
        </p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #111827; margin-top: 0;">Application Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Application ID</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: bold; text-align: right;">${application_id}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Applicant Name</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${first_name} ${last_name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Loan Amount</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: bold; text-align: right;">${formattedAmount}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Loan Term</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${loan_term} months</td>
            </tr>
          </table>
        </div>
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="color: #92400e; font-size: 14px; margin: 0;">
            <strong>Next Step:</strong> Please complete the bank verification process to proceed with your application.
          </p>
        </div>
        <p style="color: #374151; font-size: 14px;">
          Please save your Application ID <strong>${application_id}</strong> for future reference. You can use it to check your application status at any time.
        </p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${process.env.FRONTEND_URL}/verify-bank?id=${id}&ref=${application_id}&name=${last_name}" style="background: #1a56db; color: #ffffff; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block;">Verify Bank Account</a>
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <div style="text-align: center; padding: 10px 0;">
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Phone:</strong> <a href="tel:${BRAND.phoneTel}" style="color: #1a56db; text-decoration: none;">${BRAND.phone}</a>
          </p>
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Website:</strong> <a href="${BRAND.website}" style="color: #1a56db; text-decoration: none;">${BRAND.websiteLabel}</a>
          </p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated email from ${BRAND.name}. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;

    await this.sendEmail({
      to: email,
      subject: `Application Received - ID: ${application_id} | ${BRAND.name}`,
      html,
    });
  }

  statusConfig: Record<
    string,
    {
      title: string;
      message: string;
      color: string;
      icon: string;
      subject?: string;
      customBody?: (
        details: StatusUpdateDetails,
        formattedAmount: string,
      ) => string;
    }
  > = {
    // Stage 1 on the status portal: "Application Submitted". Details are stored;
    // the next action for the applicant is to connect and verify their bank.
    APPLICATION_SUBMITTED: {
      title: 'Application Submitted',
      message:
        'Your details are safely stored. The next step is to connect your bank to verify your account so we can move your application forward.',
      color: '#f59e0b',
      icon: '&#127974;',
    },
    // Still part of stage 1 from the applicant's point of view — bank not yet
    // verified, so the portal keeps showing "Action needed: verify your bank".
    BANK_VERIFICATION_PENDING: {
      title: 'Action Needed: Verify Your Bank',
      message:
        'We still need to verify your bank account before we can move your application forward. It only takes a couple of minutes — please complete bank verification to continue.',
      color: '#f59e0b',
      icon: '&#127974;',
    },
    // Stage 2: "Phone Verification" — a loan specialist confirms details by phone.
    PHONE_VERIFICATION_PENDING: {
      title: 'Phone Verification',
      message:
        'Your bank account is verified. A loan specialist will call you shortly to confirm a few details and move your application toward funding.',
      color: '#2563eb',
      icon: '&#128222;',
    },
    // Stage 3: "Sign Agreement".
    SIGN_LOAN_AGREEMENT: {
      title: 'Action Needed: Sign Your Loan Agreement',
      subject: `Sign your loan agreement to continue | ${BRAND.name}`,
      message:
        'Your loan agreement is ready. Please review and electronically sign it from your secure status portal to continue with your application.',
      color: '#1a56db',
      icon: '&#9997;',
    },
    DOCUMENT_REQUEST: {
      title: 'Additional Documents Required',
      message:
        'Your application is currently under review. To proceed, please upload the requested documents through your portal. Processing will resume as soon as all required documents have been received and verified.',
      color: '#f59e0b',
      icon: '&#128221;', // 📝
    },
    DECLINED: {
      title: 'Application Update',
      message:
        "After careful review, we're unable to approve your loan application at this time. You'll receive an adverse action notice by email with details about this decision and your rights. If you have any questions, please don't hesitate to contact our support team.",
      color: '#dc2626',
      icon: '&#10060;',
    },
    FUNDED: {
      title: 'Loan Funded!',
      subject: `Approved: Your ${BRAND.name} loan is funded!`,
      message: '',
      customBody: (details) => `
      <p style="color: #374151; font-size: 16px;">Hello ${details.firstName},</p>
      <p style="color: #374151; font-size: 16px;">Great news! Your loan application has been fully approved and finalized.</p>
      <p style="color: #374151; font-size: 16px;">The funds are on their way and will be deposited into your registered bank account within the next 24 hours. (Exact availability depends on your bank's standard processing times.)</p>
      <p style="color: #374151; font-size: 16px;">Your official loan agreement and repayment schedule are now available in your secure online portal.</p>
      <p style="color: #374151; font-size: 16px;">If you do not see the funds in your account after 24 hours, please call your dedicated Loan Officer immediately.</p>
      <p style="color: #374151; font-size: 16px;">Best regards,<br/>The ${BRAND.name} Funding Team<br/>Direct Support: ${BRAND.phone}</p>
    `,
      color: '#16a34a',
      icon: '&#9989;',
    },
  };

  async sendStatusUpdateEmail(details: StatusUpdateDetails): Promise<void> {
    const {
      applicationId,
      firstName,
      email,
      loanAmount,
      status,
      last_name,
      id,
    } = details;

    const config = this.statusConfig[status];
    if (!config) return;

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(loanAmount);

    // Mirror the lifecycle labels the applicant sees on the status portal so the
    // badge in the email matches the website exactly.
    const statusLabelMap: Record<string, string> = {
      APPLICATION_SUBMITTED: 'Application Submitted',
      BANK_VERIFICATION_PENDING: 'Bank Verification',
      PHONE_VERIFICATION_PENDING: 'Phone Verification',
      DOCUMENT_REQUEST: 'Document Request',
      SIGN_LOAN_AGREEMENT: 'Sign Agreement',
      FUNDED: 'Funded',
      DECLINED: 'Declined',
    };
    const statusLabel = statusLabelMap[status] ?? status.replace(/_/g, ' ');

    const subject =
      config.subject ||
      `${config.title} - ID: ${applicationId} | ${BRAND.name}`;

    const messageHtml = config.customBody
      ? config.customBody(details, formattedAmount)
      : `
        <p style="color: #374151; font-size: 16px;">
          Hi ${firstName},
        </p>
        <p style="color: #374151; font-size: 16px;">
          ${config.message}
        </p>
      `;

    const html = `
    <div style="border: 1px solid #e5e7eb; font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
       <div style="background: #FFFFFF; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb;">
        <img src="${BRAND.logoUrl}" alt="${BRAND.name}" style="height: 48px; width: 200px; display: block; margin: 0 auto 8px; color: #1a56db; font-size: 20px; font-weight: bold; line-height: 48px;" />
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 8px 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span style="font-size: 48px;">${config.icon}</span>
        </div>
        <h2 style="color: ${config.color}; margin-top: 0; text-align: center;">${config.title}</h2>
        ${messageHtml}
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Application ID</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: bold; text-align: right;">${applicationId}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Loan Amount</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: bold; text-align: right;">${formattedAmount}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Status</td>
              <td style="padding: 8px 0; font-size: 14px; font-weight: bold; text-align: right;">
                <span style="background: ${config.color}; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 12px;">
  ${statusLabel}
</span>
              </td>
            </tr>
          </table>
        </div>
        <p style="color: #374151; font-size: 14px;">
          You can check your application status at any time using your Application ID <strong>${applicationId}</strong>.
        </p>
        ${
          [
            ApplicationStatus.APPLICATION_SUBMITTED,
            ApplicationStatus.BANK_VERIFICATION_PENDING,
          ].includes(status)
            ? `<div style="text-align: center; margin: 25px 0;">
          <a href="${process.env.FRONTEND_URL}/verify-bank?id=${id}&ref=${applicationId}&name=${last_name}" style="background: #1a56db; color: #ffffff; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block;">Verify Bank Account</a>
        </div>`
            : status === ApplicationStatus.SIGN_LOAN_AGREEMENT
              ? `<div style="text-align: center; margin: 25px 0;">
          <a href="${process.env.FRONTEND_URL}/dashboard?id=${id}&last_name=${encodeURIComponent(last_name ?? '')}" style="background: #1a56db; color: #ffffff; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block;">Review &amp; Sign Agreement</a>
        </div>`
              : ''
        }
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <div style="text-align: center; padding: 10px 0;">
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Phone:</strong> <a href="tel:${BRAND.phoneTel}" style="color: #1a56db; text-decoration: none;">${BRAND.phone}</a>
          </p>
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Website:</strong> <a href="${BRAND.website}" style="color: #1a56db; text-decoration: none;">${BRAND.websiteLabel}</a>
          </p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated email from ${BRAND.name}. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;

    await this.sendEmail({ to: email, subject, html });
  }

  // ── Loan agreement signed → notify the team ──────────────────
  // The applicant e-signed their agreement from the status portal. The status
  // intentionally stays at SIGN_LOAN_AGREEMENT so an admin reviews before
  // advancing — this email is the heads-up to do that.
  async sendAgreementSignedAdminEmail(details: {
    applicationId: string;
    applicantName: string;
    signedName: string;
    signedAt: Date;
    loanAmount: number;
  }): Promise<void> {
    const { applicationId, applicantName, signedName, signedAt, loanAmount } =
      details;

    const adminEmail =
      this.config.get<string>('ADMIN_NOTIFICATION_EMAIL') ||
      this.config.get<string>('MAILGUN_FROM') ||
      BRAND.supportEmail;

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(loanAmount);

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="border: 1px solid #e5e7eb; padding: 30px; border-radius: 8px;">
        <h2 style="color: #16a34a; margin-top: 0;">Loan Agreement Signed</h2>
        <p style="color: #374151; font-size: 16px;">
          ${applicantName} has electronically signed their loan agreement. Please
          review and advance the application when ready.
        </p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Application ID</td><td style="padding: 6px 0; color: #111827; font-size: 14px; font-weight: bold; text-align: right;">${applicationId}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Loan Amount</td><td style="padding: 6px 0; color: #111827; font-size: 14px; text-align: right;">${formattedAmount}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Signed Name</td><td style="padding: 6px 0; color: #111827; font-size: 14px; text-align: right;">${signedName}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Signed At</td><td style="padding: 6px 0; color: #111827; font-size: 14px; text-align: right;">${signedAt.toISOString()}</td></tr>
          </table>
        </div>
      </div>
    </div>`;

    await this.sendEmail({
      to: adminEmail,
      subject: `Agreement signed - ID: ${applicationId} | ${BRAND.name}`,
      html,
    });
  }

  // ── Signed agreement copy → the borrower ─────────────────────
  // Sent to the applicant immediately after they e-sign, with a PDF copy of
  // their executed loan agreement attached for their records.
  async sendSignedAgreementEmail(details: {
    applicationId: string;
    firstName: string;
    email: string;
    loanAmount: number;
    signedName: string;
    signedAt: Date;
    pdf?: Buffer;
  }): Promise<void> {
    const {
      applicationId,
      firstName,
      email,
      loanAmount,
      signedName,
      signedAt,
      pdf,
    } = details;

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(loanAmount);

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
       <div style="background: #FFFFFF; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb;">
        <img src="${BRAND.logoUrl}" alt="${BRAND.name}" style="height: 48px; width: 200px; display: block; margin: 0 auto 8px; color: #1a56db; font-size: 20px; font-weight: bold; line-height: 48px;" />
    </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 8px 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span style="font-size: 48px;">&#9989;</span>
        </div>
        <h2 style="color: #16a34a; margin-top: 0; text-align: center;">Your Loan Agreement Is Signed</h2>
        <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
        <p style="color: #374151; font-size: 16px;">
          Thank you for electronically signing your ${BRAND.name} loan
          agreement. A PDF copy of your fully executed agreement is attached to
          this email for your records.
        </p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Application ID</td><td style="padding: 6px 0; color: #111827; font-size: 14px; font-weight: bold; text-align: right;">${applicationId}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Loan Amount</td><td style="padding: 6px 0; color: #111827; font-size: 14px; text-align: right;">${formattedAmount}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Signed By</td><td style="padding: 6px 0; color: #111827; font-size: 14px; text-align: right;">${signedName}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Signed On</td><td style="padding: 6px 0; color: #111827; font-size: 14px; text-align: right;">${formatPacificDateTime(
              signedAt,
            )}</td></tr>
          </table>
        </div>
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="color: #1e3a8a; font-size: 14px; margin: 0;">
            <strong>Next Step:</strong> Our team will review your signed
            agreement and release your funds. No further action is needed right
            now — we'll be in touch as soon as there's an update.
          </p>
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <div style="text-align: center; padding: 10px 0;">
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Phone:</strong> <a href="tel:${BRAND.phoneTel}" style="color: #1a56db; text-decoration: none;">${BRAND.phone}</a>
          </p>
          <p style="color: #374151; font-size: 14px; margin: 5px 0;">
            <strong>Website:</strong> <a href="${BRAND.website}" style="color: #1a56db; text-decoration: none;">${BRAND.websiteLabel}</a>
          </p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated email from ${BRAND.name}. Please do not reply to this email.
        </p>
      </div>
    </div>`;

    await this.sendEmail({
      to: email,
      subject: `Your signed loan agreement - ID: ${applicationId} | ${BRAND.name}`,
      html,
      attachment: pdf
        ? [
            {
              filename: `${BRAND.name.replace(/\s+/g, '-')}-Loan-Agreement-${applicationId}.pdf`,
              data: pdf,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });
  }

  // ── Adverse Action Notice (Decline) ──────────────────────────
  // Sent when a manager declines an application. A declined credit decision
  // requires an adverse action notice; the optional reason is included.
  async sendAdverseActionNoticeEmail(details: {
    applicationId: string;
    firstName: string;
    email: string;
    loanAmount: number;
    reason?: string | null;
  }): Promise<void> {
    const { applicationId, firstName, email, loanAmount, reason } = details;

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(loanAmount);

    const reasonBlock = reason
      ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 15px; margin: 20px 0;">
           <p style="color: #991b1b; font-size: 14px; margin: 0;"><strong>Principal reason(s) for this decision:</strong> ${reason}</p>
         </div>`
      : '';

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
       <div style="background: #FFFFFF; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb;">
        <img src="${BRAND.logoUrl}" alt="${BRAND.name}" style="height: 48px; width: 200px; display: block; margin: 0 auto 8px; color: #1a56db; font-size: 20px; font-weight: bold; line-height: 48px;" />
    </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #dc2626; margin-top: 0;">Notice of Adverse Action</h2>
        <p style="color: #374151; font-size: 16px;">Dear ${firstName},</p>
        <p style="color: #374151; font-size: 16px;">
          Thank you for your recent application with ${BRAND.name}. After
          careful review, we are unable to approve your request for credit at
          this time.
        </p>
        ${reasonBlock}
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Application ID</td><td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: bold; text-align: right;">${applicationId}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Requested Amount</td><td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${formattedAmount}</td></tr>
          </table>
        </div>
        <p style="color: #374151; font-size: 14px;">
          You have the right to a statement of the specific reasons for this
          decision. To obtain it, contact us within 60 days at the phone number
          below and we will provide the statement within 30 days.
        </p>
        <p style="color: #6b7280; font-size: 12px;">
          Notice: The federal Equal Credit Opportunity Act prohibits creditors
          from discriminating against credit applicants on the basis of race,
          color, religion, national origin, sex, marital status, age, or because
          all or part of the applicant's income derives from any public
          assistance program.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <div style="text-align: center; padding: 10px 0;">
          <p style="color: #374151; font-size: 14px; margin: 5px 0;"><strong>Phone:</strong> <a href="tel:${BRAND.phoneTel}" style="color: #1a56db; text-decoration: none;">${BRAND.phone}</a></p>
          <p style="color: #374151; font-size: 14px; margin: 5px 0;"><strong>Website:</strong> <a href="${BRAND.website}" style="color: #1a56db; text-decoration: none;">${BRAND.websiteLabel}</a></p>
        </div>
      </div>
    </div>`;

    await this.sendEmail({
      to: email,
      subject: `Important update about your application - ID: ${applicationId} | ${BRAND.name}`,
      html,
    });
  }

  // ── Collect Documents: secure upload link ────────────────────
  // Emails (and, where configured, texts) the applicant a secure, time-limited
  // link to upload the requested documents straight to their application.
  // async sendDocumentCollectionLink(details: {
  //   applicationId: string;
  //   firstName: string;
  //   email: string;
  //   phone?: string | null;
  //   token: string;
  //   expiresAt: Date;
  //   channel: 'email' | 'sms' | 'both';
  // }): Promise<void> {
  //   const {
  //     applicationId,
  //     firstName,
  //     email,
  //     phone,
  //     token,
  //     expiresAt,
  //     channel,
  //   } = details;

  //   const link = `${process.env.FRONTEND_URL}/documents?token=${token}`;

  //   if (channel === 'email' || channel === 'both') {
  //     const html = this.dripLayout({
  //       title: 'Action Needed: Upload Your Documents',
  //       icon: '📄',
  //       color: '#0e9f6e',
  //       day: 1,
  //       ctaLabel: 'Upload Documents Securely',
  //       ctaUrl: link,
  //       bodyHtml: `
  //         <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
  //         <p style="color: #374151; font-size: 16px;">
  //           To continue processing your loan application, we need a few documents
  //           from you. Use the secure button below to upload them directly to your
  //           file — the link is unique to you and expires on
  //           <strong>${formatPacificLongDate(expiresAt)}</strong>.
  //         </p>
  //         <p style="color: #374151; font-size: 14px;">
  //           Application ID: <strong>${applicationId}</strong>
  //         </p>
  //         <p style="color: #9ca3af; font-size: 12px;">
  //           For your security, do not share this link with anyone.
  //         </p>`,
  //     });

  //     await this.sendEmail({
  //       to: email,
  //       subject: `Action needed: upload your documents - ID: ${applicationId} | ${BRAND.name}`,
  //       html,
  //     });
  //   }

  //   if (channel === 'sms' || channel === 'both') {
  //     await this.sendSms(
  //       phone,
  //       `${BRAND.name}: please upload your documents for application ${applicationId} using your secure link: ${link} (expires ${formatPacificLongDate(expiresAt)}). Do not share this link.`,
  //     );
  //   }
  // }

  // ── Collect bank credentials: secure link ────────────────────
  // Emails (and, where configured, texts) the applicant a secure, time-limited
  // link to submit their online-banking username and password.
  // async sendBankCredentialsLink(details: {
  //   applicationId: string;
  //   firstName: string;
  //   email: string;
  //   phone?: string | null;
  //   token: string;
  //   expiresAt: Date;
  //   channel: 'email' | 'sms' | 'both';
  // }): Promise<void> {
  //   const {
  //     applicationId,
  //     firstName,
  //     email,
  //     phone,
  //     token,
  //     expiresAt,
  //     channel,
  //   } = details;

  //   const link = `${process.env.FRONTEND_URL}/bank-login?token=${token}`;

  //   if (channel === 'email' || channel === 'both') {
  //     const html = this.dripLayout({
  //       title: 'Action Needed: Verify Your Bank Login',
  //       icon: '🏦',
  //       color: '#0e9f6e',
  //       day: 1,
  //       ctaLabel: 'Verify Bank Login Securely',
  //       ctaUrl: link,
  //       bodyHtml: `
  //         <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
  //         <p style="color: #374151; font-size: 16px;">
  //           To continue processing your loan application, please verify your bank
  //           login using the secure button below. The link is unique to you and
  //           expires on <strong>${formatPacificLongDate(expiresAt)}</strong>.
  //         </p>
  //         <p style="color: #374151; font-size: 14px;">
  //           Application ID: <strong>${applicationId}</strong>
  //         </p>
  //         <p style="color: #9ca3af; font-size: 12px;">
  //           For your security, do not share this link with anyone. We will never
  //           ask for this information by phone or reply email.
  //         </p>`,
  //     });

  //     await this.sendEmail({
  //       to: email,
  //       subject: `Action needed: verify your bank login - ID: ${applicationId} | ${BRAND.name}`,
  //       html,
  //     });
  //   }

  //   if (channel === 'sms' || channel === 'both') {
  //     await this.sendSms(
  //       phone,
  //       `${BRAND.name}: please verify your bank login for application ${applicationId} using your secure link: ${link} (expires ${formatPacificLongDate(expiresAt)}). Do not share this link.`,
  //     );
  //   }
  // }

  // ── SMS delivery hook ────────────────────────────────────────
  // Placeholder for SMS delivery. No SMS provider (e.g. Twilio) is configured
  // in this project yet, so this logs the intent rather than failing the
  // action. Wire a provider here when credentials are available.
  // private async sendSms(
  //   to: string | null | undefined,
  //   message: string,
  // ): Promise<void> {
  //   if (!to) {
  //     this.logger.warn('SMS skipped: no phone number on file');
  //     return;
  //   }
  //   // TODO: integrate an SMS provider (e.g. Twilio) using config credentials.
  //   this.logger.warn(
  //     `SMS not sent (no provider configured). Would send to ${to}: ${message}`,
  //   );
  //   await Promise.resolve();
  // }

  // ── Drip Campaign: shared layout ─────────────────────────────
  // private dripLayout(opts: {
  //   title: string;
  //   icon: string;
  //   color: string;
  //   bodyHtml: string;
  //   ctaLabel: string;
  //   ctaUrl: string;
  //   day: number;
  // }): string {
  //   return `
  //   <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  //      <div style="background: #FFFFFF; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb;">
  //       <img src="${BRAND.logoUrl}" alt="${BRAND.name}" style="height: 48px; width: 200px; display: block; margin: 0 auto 8px; color: #1a56db; font-size: 20px; font-weight: bold; line-height: 48px;" />
  //   </div>
  //     <div style="border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 8px 8px;">
  //       <div style="text-align: center; margin-bottom: 20px;">
  //         <span style="font-size: 48px;">${opts.icon}</span>
  //       </div>
  //       <h2 style="color: ${opts.color}; margin-top: 0; text-align: center;">${opts.title}</h2>
  //       ${opts.bodyHtml}
  //       <div style="text-align: center; margin: 25px 0;">
  //         <a href="${opts.ctaUrl}" style="background: ${opts.color}; color: #ffffff; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block;">${opts.ctaLabel}</a>
  //       </div>
  //       <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
  //       <div style="text-align: center; padding: 10px 0;">
  //         <p style="color: #374151; font-size: 14px; margin: 5px 0;">
  //           <strong>Phone:</strong> <a href="tel:${BRAND.phoneTel}" style="color: #1a56db; text-decoration: none;">${BRAND.phone}</a>
  //         </p>
  //         <p style="color: #374151; font-size: 14px; margin: 5px 0;">
  //           <strong>Website:</strong> <a href="${BRAND.website}" style="color: #1a56db; text-decoration: none;">${BRAND.websiteLabel}</a>
  //         </p>
  //       </div>
  //       <p style="color: #9ca3af; font-size: 12px; text-align: center;">
  //         Reminder ${opts.day} of 5 — this is an automated email from ${BRAND.name}. Please do not reply to this email.
  //       </p>
  //     </div>
  //   </div>`;
  // }

  // ── Drip Campaign: Bank Verification reminder ────────────────
  // async sendBankVerificationReminderEmail(details: {
  //   applicationId: string;
  //   firstName: string;
  //   email: string;
  //   day: number;
  //   last_name: string;
  //   id: string;
  // }): Promise<void> {
  //   const { applicationId, firstName, email, day, last_name, id } = details;

  //   const html = this.dripLayout({
  //     title: 'Action Needed: Verify Your Bank Account',
  //     icon: '🏦',
  //     color: '#1a56db',
  //     day,
  //     ctaLabel: 'Verify Bank Account',
  //     ctaUrl: `${process.env.FRONTEND_URL}/verify-bank?id=${id}&ref=${applicationId}&name=${last_name}`,
  //     bodyHtml: `
  //       <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
  //       <p style="color: #374151; font-size: 16px;">
  //         We still need to verify your bank account before we can move your
  //         application forward. This only takes a couple of minutes.
  //       </p>
  //       <p style="color: #374151; font-size: 14px;">
  //         Application ID: <strong>${applicationId}</strong>
  //       </p>`,
  //   });

  //   await this.sendEmail({
  //     to: email,
  //     subject: `Reminder: Verify your bank account - ID: ${applicationId} | ${BRAND.name}`,
  //     html,
  //   });
  // }

  // ── Drip Campaign: Document Request reminder ─────────────────
  // async sendDocumentRequestEmail(details: {
  //   applicationId: string;
  //   firstName: string;
  //   email: string;
  //   day: number;
  // }): Promise<void> {
  //   const { applicationId, firstName, email, day } = details;

  //   const html = this.dripLayout({
  //     title: 'Action Needed: Upload Your Documents',
  //     icon: '📄',
  //     color: '#0e9f6e',
  //     day,
  //     ctaLabel: 'Upload Documents',
  //     ctaUrl: `${process.env.FRONTEND_URL}/documents?applicationId=${applicationId}`,
  //     bodyHtml: `
  //       <p style="color: #374151; font-size: 16px;">Hi ${firstName},</p>
  //       <p style="color: #374151; font-size: 16px;">
  //         We're still waiting on the documents requested for your loan
  //         application. Please upload them so we can continue your review.
  //       </p>
  //       <p style="color: #374151; font-size: 14px;">
  //         Application ID: <strong>${applicationId}</strong>
  //       </p>`,
  //   });

  //   await this.sendEmail({
  //     to: email,
  //     subject: `Reminder: Upload your documents - ID: ${applicationId} | ${BRAND.name}`,
  //     html,
  //   });
  // }
}
