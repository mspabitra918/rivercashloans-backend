import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BannedRoutingNumber } from './models/banned-routing-number.model';
import { BankDetail } from './models/bank-detail.model';
import { ApplicationsService } from '../applications/applications.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../notifications/email.service';
import { ApplicationStatus, LOAN } from '../common/constants';

export interface GatekeeperResult {
  status: ApplicationStatus;
  reason: string;
  dti: number;
}

/**
 * The "Gatekeeper" rules engine. Runs when bank details are submitted (the step
 * that completes an application). 100% internal logic — no credit-bureau APIs.
 *
 * NOTE: invoked inline here for determinism/testability. In production this
 * should run as a queued job (e.g. BullMQ) so the submit API returns instantly
 * and the check retries on failure.
 */
@Injectable()
export class GatekeeperService {
  private readonly logger = new Logger(GatekeeperService.name);

  constructor(
    @InjectModel(BannedRoutingNumber)
    private readonly bannedModel: typeof BannedRoutingNumber,
    @InjectModel(BankDetail)
    private readonly bankModel: typeof BankDetail,
    @Inject(forwardRef(() => ApplicationsService))
    private readonly applications: ApplicationsService,
    private readonly users: UsersService,
    private readonly email: EmailService,
  ) {}

  async evaluate(
    applicationId: string,
    bankDetailId: string,
  ): Promise<GatekeeperResult> {
    const app = await this.applications.findById(applicationId);
    const user = await this.users.findById(app.userId);
    const income = Number(app.grossMonthlyIncome);
    const dti = Number(app.calculatedDti);

    // 1) INCOME GATE — absolute, evaluated first.
    if (income < LOAN.minMonthlyIncome) {
      const reason = `Gross monthly income $${income} is below the $${LOAN.minMonthlyIncome} minimum.`;
      await this.applications.updateStatus(
        applicationId,
        ApplicationStatus.DECLINED,
        reason,
      );
      await this.email.declined(user.email, user.firstName);
      return { status: ApplicationStatus.DECLINED, reason, dti };
    }

    // 2) ROUTING-NUMBER CHECK — banned prepaid / BaaS neobanks.
    const bank = await this.bankModel.findByPk(bankDetailId);
    const banned = bank
      ? await this.bannedModel.findByPk(bank.routingNumber)
      : null;
    if (banned) {
      const reason = `Routing number ${bank!.routingNumber} (${banned.bankName}) is not eligible: ${banned.reason}.`;
      await this.applications.updateStatus(
        applicationId,
        ApplicationStatus.BANK_REJECTED,
        reason,
      );
      // Correction Email asks for a new, eligible bank account.
      await this.email.bankCorrection(user.email, user.firstName, app?.id);
      return { status: ApplicationStatus.BANK_REJECTED, reason, dti };
    }

    // Routing is safe — simulate the bank verification API success so the
    // admin dual-view has an "API-verified" signal. (Real provider: TODO.)
    if (bank) {
      bank.apiVerified = true;
      await bank.save();
    }

    // 3) DTI ROUTING (DTI already computed + persisted at application create).
    if (dti < LOAN.maxDtiPercent) {
      const reason = `DTI ${dti}% is under ${LOAN.maxDtiPercent}% — fast-tracked.`;
      await this.applications.updateStatus(
        applicationId,
        ApplicationStatus.PENDING_VERIFICATION,
        reason,
      );
      await this.email.loanApproved(user.email, user.firstName, app?.id);
      return { status: ApplicationStatus.PENDING_VERIFICATION, reason, dti };
    }

    // 4) Everything else -> manual underwriter review.
    const reason = `DTI ${dti}% is at/above ${LOAN.maxDtiPercent}% — routed to manual review.`;
    await this.applications.updateStatus(
      applicationId,
      ApplicationStatus.MANUAL_REVIEW,
      reason,
    );
    await this.email.underwriterReview(user.email, user.firstName, app?.id);
    return { status: ApplicationStatus.MANUAL_REVIEW, reason, dti };
  }
}
