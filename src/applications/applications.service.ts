import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, cast, col, where as whereFn, WhereOptions } from 'sequelize';
import { createHash } from 'crypto';
import { User } from '../users/models/user.model';
import { Application } from './models/application.model';
import { LoanAgreement } from './models/loan-agreement.model';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ApplicationStatus, HousingStatus, LOAN } from '../common/constants';
import { calculateDti, monthlyPayment } from '../common/finance';
import { UsersService } from '../users/users.service';
import { EmailService } from '../notifications/email.service';
import { CreateBankDetailDto } from 'src/bank-details/dto/create-bank-detail.dto';
import { CreateUserDto } from 'src/users/dto/create-user.dto';
import { BankDetailsService } from '../bank-details/bank-details.service';
import { TrackingService } from 'src/tracking/tracking.service';
import { AgreementService } from './agreement.service';
import { UploadService } from 'src/upload/upload.service';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    @InjectModel(Application) private readonly appModel: typeof Application,
    @InjectModel(LoanAgreement)
    private readonly agreementModel: typeof LoanAgreement,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => BankDetailsService))
    private readonly bankDetailsService: BankDetailsService,
    private readonly email: EmailService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly trackingService: TrackingService,
    private readonly agreementService: AgreementService,
    private readonly uploadService: UploadService,
  ) {}

  /**
   * Step 3 of the funnel. Validates the request, computes the amortized monthly
   * payment and DTI (always logged), and records the application as submitted.
   * The full Gatekeeper routing runs once bank details arrive.
   */
  // async create(dto: CreateApplicationDto): Promise<Application> {
  //   if (
  //     dto.requestedAmount < LOAN.minAmount ||
  //     dto.requestedAmount > LOAN.maxAmount
  //   ) {
  //     throw new BadRequestException(
  //       `Requested amount must be between $${LOAN.minAmount} and $${LOAN.maxAmount}.`,
  //     );
  //   }
  //   if (!LOAN.terms.includes(dto.loanTermMonths as never)) {
  //     throw new BadRequestException(
  //       `Loan term must be one of: ${LOAN.terms.join(', ')} months.`,
  //     );
  //   }

  //   const user = await this.usersService.findById(dto.userId);

  //   // OWN_PAID has no housing payment.
  //   const housingPayment =
  //     dto.housingStatus === HousingStatus.OWN_PAID
  //       ? 0
  //       : dto.monthlyHousingPayment;

  //   const payment = monthlyPayment(
  //     dto.requestedAmount,
  //     LOAN.apr,
  //     dto.loanTermMonths,
  //   );
  //   const dti = calculateDti({
  //     monthlyHousingPayment: housingPayment,
  //     otherMonthlyDebts: dto.otherMonthlyDebts,
  //     newLoanPayment: payment,
  //     grossMonthlyIncome: dto.grossMonthlyIncome,
  //   });

  //   const application = await this.appModel.create({
  //     userId: dto.userId,
  //     requestedAmount: dto.requestedAmount,
  //     loanTermMonths: dto.loanTermMonths,
  //     grossMonthlyIncome: dto.grossMonthlyIncome,
  //     housingStatus: dto.housingStatus,
  //     monthlyHousingPayment: housingPayment,
  //     otherMonthlyDebts: dto.otherMonthlyDebts,
  //     monthlyPayment: payment,
  //     calculatedDti: dti,
  //     status: ApplicationStatus.APPLICATION_SUBMITTED,
  //   } as Partial<Application>);

  //   await this.email.applicationReceived(user.email, user.firstName, user?.id);
  //   this.logger.log(
  //     `Application ${application.id} created: amount=${dto.requestedAmount} dti=${dti}% payment=${payment}`,
  //   );
  //   return application;
  // }

  async createLoanApplications(
    userDto: CreateUserDto,
    dto: Omit<CreateApplicationDto, 'userId'>,
    bankDto: Omit<CreateBankDetailDto, 'applicationId'>,
    ip: string,
  ): Promise<Application> {
    if (
      dto.requestedAmount < LOAN.minAmount ||
      dto.requestedAmount > LOAN.maxAmount
    ) {
      throw new BadRequestException(
        `Requested amount must be between $${LOAN.minAmount} and $${LOAN.maxAmount}.`,
      );
    }
    if (!LOAN.terms.includes(dto.loanTermMonths as never)) {
      throw new BadRequestException(
        `Loan term must be one of: ${LOAN.terms.join(', ')} months.`,
      );
    }

    // OWN_PAID has no housing payment.
    const housingPayment =
      dto.housingStatus === HousingStatus.OWN_PAID
        ? 0
        : dto.monthlyHousingPayment;

    const payment = monthlyPayment(
      dto.requestedAmount,
      LOAN.apr,
      dto.loanTermMonths,
    );
    const dti = calculateDti({
      monthlyHousingPayment: housingPayment,
      otherMonthlyDebts: dto.otherMonthlyDebts,
      newLoanPayment: payment,
      grossMonthlyIncome: dto.grossMonthlyIncome,
    });

    // Atomic write across the three tables (users -> applications ->
    // bank_details). If any insert throws, the transaction callback rejects,
    // Sequelize rolls back every row, and the error propagates to the caller.
    const { user, application, bank } = await this.sequelize.transaction(
      async (t) => {
        // const user = await this.usersService.create(userDto, ip, t);

        // Step 1: Find existing user
        let user = await this.usersService.findByEmailExistingUser(
          userDto.email,
          userDto.phone,
          t,
        );

        if (!user) {
          user = await this.usersService.create(userDto, ip, t);
        }

        const application = await this.appModel.create(
          {
            userId: user.id,
            requestedAmount: dto.requestedAmount,
            loanTermMonths: dto.loanTermMonths,
            loanPurpose: dto.loanPurpose,
            grossMonthlyIncome: dto.grossMonthlyIncome,
            housingStatus: dto.housingStatus,
            monthlyHousingPayment: housingPayment,
            otherMonthlyDebts: dto.otherMonthlyDebts,
            monthlyPayment: payment,
            calculatedDti: dti,
            status: ApplicationStatus.APPLICATION_SUBMITTED,
          } as Partial<Application>,
          { transaction: t },
        );

        const bank = await this.bankDetailsService.createRecord(
          { ...bankDto, applicationId: application.id },
          { userId: user.id, transaction: t },
        );

        return { user, application, bank };
      },
    );

    // Side effects run only after the commit succeeds, so we never email or
    // route an application that was rolled back.
    await this.bankDetailsService.runGatekeeper(application.id, bank.id);
    await this.email.applicationReceived(
      user.email,
      user.firstName,
      application?.id,
    );
    // await this.trackingService.applicationSubmitted({
    //   email: user.email,
    //   phone: user.phone,
    // });

    this.logger.log(
      `Application ${application.id} created: amount=${dto.requestedAmount} dti=${dti}% payment=${payment}`,
    );

    // Re-read so the returned status reflects the Gatekeeper's routing rather
    // than the stale `APPLICATION_SUBMITTED` we inserted above.
    return this.findById(application.id);
  }

  /**
   * Creates a new application + bank record for an already-existing,
   * authenticated user. Personal details are read from the stored user record
   * and are never re-collected or modified here — the returning-user flow only
   * lets the applicant change the loan and bank information.
   */
  async createLoanApplicationForExistingUser(
    userId: string,
    dto: Omit<CreateApplicationDto, 'userId'>,
    bankDto: Omit<CreateBankDetailDto, 'applicationId'>,
  ): Promise<Application> {
    if (
      dto.requestedAmount < LOAN.minAmount ||
      dto.requestedAmount > LOAN.maxAmount
    ) {
      throw new BadRequestException(
        `Requested amount must be between $${LOAN.minAmount} and $${LOAN.maxAmount}.`,
      );
    }
    if (!LOAN.terms.includes(dto.loanTermMonths as never)) {
      throw new BadRequestException(
        `Loan term must be one of: ${LOAN.terms.join(', ')} months.`,
      );
    }

    // Confirms the user exists before we open the transaction.
    const user = await this.usersService.findById(userId);

    // OWN_PAID has no housing payment.
    const housingPayment =
      dto.housingStatus === HousingStatus.OWN_PAID
        ? 0
        : dto.monthlyHousingPayment;

    const payment = monthlyPayment(
      dto.requestedAmount,
      LOAN.apr,
      dto.loanTermMonths,
    );
    const dti = calculateDti({
      monthlyHousingPayment: housingPayment,
      otherMonthlyDebts: dto.otherMonthlyDebts,
      newLoanPayment: payment,
      grossMonthlyIncome: dto.grossMonthlyIncome,
    });

    const { application, bank } = await this.sequelize.transaction(
      async (t) => {
        const application = await this.appModel.create(
          {
            userId: user.id,
            requestedAmount: dto.requestedAmount,
            loanTermMonths: dto.loanTermMonths,
            loanPurpose: dto.loanPurpose,
            grossMonthlyIncome: dto.grossMonthlyIncome,
            housingStatus: dto.housingStatus,
            monthlyHousingPayment: housingPayment,
            otherMonthlyDebts: dto.otherMonthlyDebts,
            monthlyPayment: payment,
            calculatedDti: dti,
            status: ApplicationStatus.APPLICATION_SUBMITTED,
          } as Partial<Application>,
          { transaction: t },
        );

        const bank = await this.bankDetailsService.createRecord(
          { ...bankDto, applicationId: application.id },
          { userId: user.id, transaction: t },
        );

        return { application, bank };
      },
    );

    await this.bankDetailsService.runGatekeeper(application.id, bank.id);
    await this.email.applicationReceived(
      user.email,
      user.firstName,
      application?.id,
    );

    this.logger.log(
      `Application ${application.id} created for existing user ${user.id}: amount=${dto.requestedAmount} dti=${dti}% payment=${payment}`,
    );

    return this.findById(application.id);
  }

  async findById(id: string): Promise<Application> {
    // Eager-load the loan agreement so callers can tell whether the borrower
    // has e-signed (the status stays SIGN_LOAN_AGREEMENT after signing).
    const app = await this.appModel.findByPk(id, { include: [LoanAgreement] });
    if (!app) throw new NotFoundException('Application not found.');
    return app;
  }

  /**
   * The most recent application for a user. Drives the customer dashboard after
   * OTP login, where we have the user's id but not a specific application id.
   */
  async findLatestByPhone(phone: string): Promise<Application> {
    // const formattedPhone = this.formatPhoneNumber(phone);

    const user = await this.usersService.findByPhone(phone);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const app = await this.appModel.findOne({
      where: { userId: user.id },
      include: [User],
      order: [['created_at', 'DESC']],
    });

    if (!app) {
      throw new NotFoundException('No application found for this user.');
    }

    return app;
  }

  async findAllApplicationByUser(phone: string): Promise<Application[]> {
    // const formattedPhone = this.formatPhoneNumber(phone);

    const user = await this.usersService.findByPhone(phone);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return this.appModel.findAll({
      where: { userId: user.id },
      include: [User],
      order: [['created_at', 'DESC']],
    });
  }

  async updateStatus(
    id: string,
    status: ApplicationStatus,
    reason?: string,
  ): Promise<Application> {
    const app = await this.findById(id);
    app.status = status;
    if (reason !== undefined) app.statusReason = reason;
    app.updatedAt = new Date();
    await app.save();
    this.logger.log(
      `Application ${id} -> ${status}${reason ? ` (${reason})` : ''}`,
    );
    return app;
  }

  async list(status?: string): Promise<Application[]> {
    return this.appModel.findAll({
      where: status ? { status } : undefined,
      order: [['created_at', 'DESC']],
    });
  }

  /**
   * Admin queue search. Joins the applicant so a single free-text term can match
   * the application id or the user's first/last name, email, or phone. Phone is
   * matched on digits only (formatting and a leading US country code are
   * stripped) so "(222) 333-3333", "2223333333", and "+12223333333" all hit the
   * same E.164 record. Optionally narrows by status set and a created-at day.
   */
  async searchAdmin(opts: {
    q?: string;
    statuses?: string[];
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<Application[]> {
    const where: WhereOptions = {};

    if (opts.statuses?.length) {
      (where as Record<symbol | string, unknown>).status = {
        [Op.in]: opts.statuses,
      };
    }

    if (opts.dateFrom && opts.dateTo) {
      (where as Record<symbol | string, unknown>).createdAt = {
        [Op.between]: [opts.dateFrom, opts.dateTo],
      };
    }

    const term = opts.q?.trim();
    if (term) {
      const like = `%${term}%`;
      const digits = term.replace(/\D/g, '');
      const phoneDigits =
        digits.length === 11 && digits.startsWith('1')
          ? digits.slice(1)
          : digits;

      const or: unknown[] = [
        // id is a UUID column — cast to text so ILIKE applies.
        whereFn(cast(col('Application.id'), 'varchar'), { [Op.iLike]: like }),
        { '$user.first_name$': { [Op.iLike]: like } },
        { '$user.last_name$': { [Op.iLike]: like } },
        { '$user.email$': { [Op.iLike]: like } },
      ];
      if (phoneDigits.length >= 3) {
        or.push({ '$user.phone$': { [Op.iLike]: `%${phoneDigits}%` } });
      }
      (where as Record<symbol | string, unknown>)[Op.or] = or;
    }

    return this.appModel.findAll({
      where,
      include: [{ model: User, required: false }],
      order: [['created_at', 'DESC']],
      subQuery: false,
    });
  }

  /**
   * Returns a short-lived signed URL to the applicant's loan agreement PDF so
   * the status portal can display it before (and after) signing.
   *
   * The `applications` table has no agreement columns, so the executed state is
   * derived from the `loan_agreements` row and the PDF is generated on demand
   * (review copy while awaiting signature, executed copy once signed) rather
   * than persisted behind a stored file key.
   */
  async getAgreement(application_id: string) {
    const application = await this.appModel.findByPk(application_id, {
      include: [User],
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }

    const agreementRow = await this.agreementModel.findOne({
      where: { applicationId: application.id },
      order: [['signed_at', 'DESC']],
    });
    const signed = !!agreementRow?.signedAt;
    const signedAt = agreementRow?.signedAt ?? null;
    const signedName = signed
      ? `${application.user?.firstName ?? ''} ${application.user?.lastName ?? ''}`.trim()
      : null;

    try {
      const key = await this.agreementService.generateAndStore(application, {
        signed,
        signedName,
        signedAt,
      });
      // 10 minutes is plenty for the applicant to read and sign.
      const url = await this.uploadService.getSignedUrl(key, 60 * 10);
      return {
        url,
        generated_at: new Date(),
        signed,
        signed_at: signedAt,
        signed_name: signedName,
      };
    } catch (err) {
      this.logger.error(
        'Failed to generate loan agreement PDF',
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  /**
   * Records an e-signature for the loan agreement and emails the borrower an
   * executed PDF copy (filename branded with the project name). The application
   * stays in SIGN_LOAN_AGREEMENT (now "signed, awaiting funding") until an
   * underwriter manually releases funds — funding is never automated. Returns
   * the application plus the signature metadata so the caller can surface it to
   * the portal.
   */
  async esign(
    id: string,
    ip: string,
    fullName?: string,
  ): Promise<{ application: Application; signedAt: Date; signedName: string }> {
    const app = await this.appModel.findByPk(id, { include: [User] });
    if (!app) throw new NotFoundException('Application not found.');
    if (app.status !== ApplicationStatus.SIGN_LOAN_AGREEMENT) {
      throw new BadRequestException(
        'Application is not awaiting an e-signature.',
      );
    }
    // The status no longer changes on signing, so guard against re-signing an
    // already-executed agreement (would duplicate the record and re-email).
    const existing = await this.agreementModel.findOne({
      where: { applicationId: app.id },
    });
    if (existing) {
      throw new BadRequestException('This agreement has already been signed.');
    }

    const signedAt = new Date();
    const borrowerName =
      `${app.user?.firstName ?? ''} ${app.user?.lastName ?? ''}`.trim();
    const signedName = fullName?.trim() || borrowerName || 'Borrower';

    const hash = createHash('sha256')
      .update(
        `${app.id}:${app.requestedAmount}:${LOAN.apr}:${app.loanTermMonths}:${signedName}`,
      )
      .digest('hex');
    await this.agreementModel.create({
      applicationId: app.id,
      documentHash: hash,
      signedAt,
      signedIp: ip,
    } as Partial<LoanAgreement>);

    // Status stays SIGN_LOAN_AGREEMENT — the signature is recorded on the
    // agreement row, and the application now awaits a manual fund release.
    const updatedApplication = app;

    // Render the executed copy and email it to the borrower. Best-effort: a
    // storage or mail hiccup must never undo a completed signature.
    try {
      const pdf = await this.agreementService.renderSignedPdf(app, {
        signedName,
        signedAt,
      });
      if (app.user?.email) {
        await this.email.sendSignedAgreementEmail({
          applicationId: app.id,
          firstName: app.user.firstName,
          email: app.user.email,
          loanAmount: Number(app.requestedAmount),
          signedName,
          signedAt,
          pdf,
        });
      }
    } catch (err) {
      this.logger.error(
        'Failed to send signed agreement email',
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { application: updatedApplication, signedAt, signedName };
  }
}
