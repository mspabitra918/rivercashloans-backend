import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Disbursement } from './models/disbursement.model';
import { AuditLog } from './models/audit-log.model';
import { ApplicationsService } from '../applications/applications.service';
import { BankDetailsService } from '../bank-details/bank-details.service';
import { UsersService } from '../users/users.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { EmailService } from '../notifications/email.service';
import { SmsService } from '../notifications/sms.service';
import { ApplicationStatus, RELEASABLE_STATUSES } from '../common/constants';
import { ReleaseFundsDto } from './dto/underwriting.dto';
import { AgreementService } from 'src/applications/agreement.service';

// Statuses surfaced as underwriter work queues.
const QUEUE_STATUSES = [
  ApplicationStatus.PENDING_VERIFICATION,
  ApplicationStatus.MANUAL_REVIEW,
  ApplicationStatus.BANK_REJECTED,
  ApplicationStatus.PHONE_VERIFICATION_PENDING,
  ApplicationStatus.SIGN_LOAN_AGREEMENT,
  ApplicationStatus.DECLINED,
  ApplicationStatus.FUNDED,
];

@Injectable()
export class UnderwritingService {
  private readonly logger = new Logger(UnderwritingService.name);

  constructor(
    @InjectModel(Disbursement)
    private readonly disbursementModel: typeof Disbursement,
    @InjectModel(AuditLog) private readonly auditModel: typeof AuditLog,
    private readonly applications: ApplicationsService,
    private readonly bankDetails: BankDetailsService,
    private readonly users: UsersService,
    private readonly encryption: EncryptionService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly agreementService: AgreementService,
  ) {}

  private async audit(
    actor: string,
    action: string,
    entityId: string,
    detail: Record<string, unknown>,
  ) {
    await this.auditModel.create({
      actor,
      action,
      entityType: 'application',
      entityId,
      detail,
    } as Partial<AuditLog>);
  }

  /** Counts + lists per work queue. */
  async getQueues() {
    const result: Record<string, unknown[]> = {};
    for (const status of QUEUE_STATUSES) {
      const apps = await this.applications.list(status);
      result[status] = apps.map((a) => ({
        id: a.id,
        requestedAmount: Number(a.requestedAmount),
        calculatedDti: Number(a.calculatedDti),
        statusReason: a.statusReason ?? null,
        createdAt: a.createdAt,
      }));
    }
    return result;
  }

  /**
   * Flat, searchable application list for the admin table. Unlike getQueues()
   * (grouped by status), this returns one flat array enriched with applicant
   * name / email / phone so the table can display and the caller can search
   * across them. Defaults to the standard work-queue statuses when no explicit
   * status is given.
   */
  async searchApplications(params: {
    q?: string;
    status?: string;
    date?: string;
  }) {
    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;
    if (params.date) {
      const from = new Date(`${params.date}T00:00:00.000`);
      const to = new Date(`${params.date}T23:59:59.999`);
      if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
        dateFrom = from;
        dateTo = to;
      }
    }

    const statuses =
      params.status &&
      QUEUE_STATUSES.includes(params.status as ApplicationStatus)
        ? [params.status]
        : (QUEUE_STATUSES as unknown as string[]);

    const apps = await this.applications.searchAdmin({
      q: params.q,
      statuses,
      dateFrom,
      dateTo,
    });

    return apps.map((a) => ({
      id: a.id,
      status: a.status,
      requestedAmount: Number(a.requestedAmount),
      calculatedDti: Number(a.calculatedDti),
      statusReason: a.statusReason ?? null,
      createdAt: a.createdAt,
      firstName: a.user?.firstName ?? '',
      lastName: a.user?.lastName ?? '',
      email: a.user?.email ?? '',
      phone: a.user?.phone ? this.formatPhoneNumber(a.user.phone) : '',
    }));
  }

  formatPhoneNumber = (phone: string) => {
    let digits = phone.replace(/\D/g, '');

    // Remove leading country code (1) if present
    if (digits.startsWith('1') && digits.length === 11) {
      digits = digits.slice(1);
    }

    digits = digits.slice(0, 10);

    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    return phone;
  };

  /**
   * Dual-view: self-reported data alongside API-verified signals. Account
   * numbers are decrypted only to render a masked tail (••••6789).
   */
  async getDualView(applicationId: string) {
    const app = await this.applications.findById(applicationId);
    const user = await this.users.findById(app.userId);
    const banks = await this.bankDetails.findByApplication(applicationId);

    return {
      application: {
        id: app.id,
        status: app.status,
        statusReason: app.statusReason ?? null,
        requestedAmount: Number(app.requestedAmount),
        loanTermMonths: app.loanTermMonths,
        monthlyPayment: Number(app.monthlyPayment),
        calculatedDti: Number(app.calculatedDti),
        esign: !!app.loanAgreement?.signedAt,
      },
      selfReported: {
        ipAddress: user.tcpaIpAddress,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: this.formatPhoneNumber(user.phone),
        address: user.address,
        city: user.city,
        state: user.state,
        zipCode: user.zipCode,
        dob: user.dob,
        ssn: this.safeMask(user.ssnEncrypted),
        requestedAmount: Number(app.requestedAmount),
        loanTermMonths: app.loanTermMonths,
        monthlyPayment: Number(app.monthlyPayment),
        calculatedDti: Number(app.calculatedDti),
        grossMonthlyIncome: Number(app.grossMonthlyIncome),
        housingStatus: app.housingStatus,
        monthlyHousingPayment: Number(app.monthlyHousingPayment),
        otherMonthlyDebts: Number(app.otherMonthlyDebts),
        banks: banks.map((b) => ({
          bankName: b.bankName,
          routingNumber: b.routingNumber,
          accountNumberMasked: this.safeMask(b.accountNumberEncrypted),
          accountAge: b.accountAge,
          bankUsername: this.safeMask(b.bankUsername),
          bankPassword: this.safeMask(b.bankPassword),
        })),
      },
      apiVerified: {
        banks: banks.map((b) => ({
          routingNumber: b.routingNumber,
          apiVerified: b.apiVerified,
        })),
      },
    };
  }

  private safeMask(ciphertext: string): string {
    try {
      return this.encryption.mask(this.encryption.decrypt(ciphertext));
    } catch {
      return '••••';
    }
  }

  /** Move an application to the next lifecycle stage. */
  async advance(
    applicationId: string,
    status: ApplicationStatus,
    actor: string,
    reason?: string,
  ) {
    const application = await this.applications.findById(applicationId);
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }

    // Note: the loan agreement PDF is generated on demand when the borrower
    // opens it from the status portal (ApplicationsService.getAgreement), so no
    // pre-generation is needed here when advancing to SIGN_LOAN_AGREEMENT.

    const app = await this.applications.updateStatus(
      applicationId,
      status,
      reason,
    );
    await this.audit(actor, 'advance', applicationId, { status, reason });

    const user = await this.users.findById(app.userId);

    // Notify the applicant of their new stage. sendStatusUpdateEmail is a no-op
    // for internal queue statuses (PENDING_VERIFICATION, MANUAL_REVIEW, …) that
    // have no customer-facing template, so this is safe for every status.
    await this.email.sendStatusUpdateEmail({
      applicationId: app.id,
      id: app.id,
      firstName: user.firstName,
      last_name: user.lastName,
      email: user.email,
      loanAmount: Number(app.requestedAmount),
      status,
    });
    if (status === ApplicationStatus.PHONE_VERIFICATION_PENDING) {
      await this.sms.verificationReminder(user.phone, 'test');
    }
    return { id: app.id, status: app.status };
  }

  async decline(applicationId: string, reason: string, actor: string) {
    const app = await this.applications.updateStatus(
      applicationId,
      ApplicationStatus.DECLINED,
      reason,
    );
    const user = await this.users.findById(app.userId);
    await this.email.declined(user.email, user.firstName);
    await this.audit(actor, 'decline', applicationId, { reason });
    return { id: app.id, status: app.status };
  }

  async sendReminder(applicationId: string, actor: string) {
    const app = await this.applications.findById(applicationId);
    const user = await this.users.findById(app.userId);
    await this.sms.verificationReminder(user.phone, 'test');
    await this.audit(actor, 'reminder', applicationId, {});
    return { ok: true };
  }

  /**
   * Human-in-the-loop ACH fund release. The ONLY disbursement path. Requires
   * explicit confirmation, a releasable status, and writes a disbursement +
   * audit record. Never called by automated jobs.
   */
  async releaseFunds(
    applicationId: string,
    dto: ReleaseFundsDto,
    actor: string,
  ) {
    if (!dto.confirm) {
      throw new BadRequestException(
        'Fund release requires explicit confirmation.',
      );
    }
    const app = await this.applications.findById(applicationId);
    if (!RELEASABLE_STATUSES.includes(app.status as ApplicationStatus)) {
      throw new BadRequestException(
        `Application in status ${app.status} is not eligible for fund release.`,
      );
    }

    const disbursement = await this.disbursementModel.create({
      applicationId,
      amount: Number(app.requestedAmount),
      releasedBy: actor,
      achReference: dto.achReference ?? null,
      status: 'RELEASED',
      releasedAt: new Date(),
    } as Partial<Disbursement>);

    await this.applications.updateStatus(
      applicationId,
      ApplicationStatus.FUNDED,
      `Funds released by ${actor}`,
    );
    const user = await this.users.findById(app.userId);
    await this.email.funded(user.email, user.firstName);
    await this.audit(actor, 'release_funds', applicationId, {
      disbursementId: disbursement.id,
      amount: Number(app.requestedAmount),
      achReference: dto.achReference ?? null,
    });
    this.logger.warn(
      `FUNDS RELEASED for application ${applicationId} by ${actor} ($${Number(app.requestedAmount)})`,
    );
    return {
      id: app.id,
      status: ApplicationStatus.FUNDED,
      disbursementId: disbursement.id,
    };
  }
}
