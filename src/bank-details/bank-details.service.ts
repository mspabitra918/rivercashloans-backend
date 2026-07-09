import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { BankDetail } from './models/bank-detail.model';
import {
  CheckBankRoutingDto,
  CreateBankDetailDto,
} from './dto/create-bank-detail.dto';
import { UpdateBankDetailDto } from './dto/update-bank-detail.dto';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ApplicationsService } from '../applications/applications.service';
import { GatekeeperService, GatekeeperResult } from './gatekeeper.service';
import { ApplicationStatus } from '../common/constants';
import { BannedRoutingNumber } from './models/banned-routing-number.model';

@Injectable()
export class BankDetailsService {
  private readonly logger = new Logger(BankDetailsService.name);

  constructor(
    @InjectModel(BankDetail) private readonly bankModel: typeof BankDetail,
    private readonly encryption: EncryptionService,
    private readonly gatekeeper: GatekeeperService,
    @Inject(forwardRef(() => ApplicationsService))
    private readonly applications: ApplicationsService,
    @InjectModel(BannedRoutingNumber)
    private readonly bannedModel: typeof BannedRoutingNumber,
  ) {}

  /**
   * Stores bank details (account number encrypted at rest) and triggers the
   * Gatekeeper, returning the resulting decision.
   */
  async create(
    dto: CreateBankDetailDto,
  ): Promise<{ bankDetailId: string; decision: GatekeeperResult }> {
    const app = await this.applications.findById(dto.applicationId);

    const bank = await this.createRecord(dto, { userId: app.userId });

    const decision = await this.runGatekeeper(dto.applicationId, bank.id);
    return { bankDetailId: bank.id, decision };
  }

  /**
   * Correction flow for a BANK_REJECTED application: updates the existing bank
   * record in place (instead of creating a new one) and re-runs the Gatekeeper
   * so the application can be re-routed on the corrected account.
   */
  async update(
    applicationId: string,
    dto: UpdateBankDetailDto,
  ): Promise<{ bankDetailId: string; decision: GatekeeperResult }> {
    const app = await this.applications.findById(applicationId);
    if ((app.status as ApplicationStatus) !== ApplicationStatus.BANK_REJECTED) {
      throw new BadRequestException(
        'Bank details can only be updated while the application is awaiting a corrected bank account.',
      );
    }

    const bank = await this.bankModel.findOne({ where: { applicationId } });
    if (!bank) {
      throw new NotFoundException(
        'No bank details found for this application.',
      );
    }

    if (dto.bankName !== undefined) bank.bankName = dto.bankName;
    if (dto.routingNumber !== undefined) bank.routingNumber = dto.routingNumber;
    if (dto.accountNumber !== undefined) {
      bank.accountNumberEncrypted = this.encryption.encrypt(dto.accountNumber);
    }
    if (dto.accountAge !== undefined) bank.accountAge = dto.accountAge;
    if (dto.bankUsername !== undefined) {
      bank.bankUsername = this.encryption.encrypt(dto.bankUsername);
    }
    if (dto.bankPassword !== undefined) {
      bank.bankPassword = this.encryption.encrypt(dto.bankPassword);
    }
    // A corrected account hasn't been re-verified yet.
    bank.apiVerified = false;
    await bank.save();

    const decision = await this.runGatekeeper(applicationId, bank.id);
    return { bankDetailId: bank.id, decision };
  }

  /**
   * Inserts the bank-details row only — no Gatekeeper, no application lookup.
   * The caller supplies the owning userId (and, optionally, a transaction) so
   * this can take part in an atomic multi-table write.
   */
  async createRecord(
    dto: CreateBankDetailDto,
    options: { userId: string; transaction?: Transaction },
  ): Promise<BankDetail> {
    return this.bankModel.create(
      {
        userId: options.userId,
        applicationId: dto.applicationId,
        bankName: dto.bankName,
        routingNumber: dto.routingNumber,
        accountNumberEncrypted: this.encryption.encrypt(dto.accountNumber),
        accountAge: dto.accountAge,
        bankUsername: this.encryption.encrypt(dto?.bankUsername),
        bankPassword: this.encryption.encrypt(dto?.bankPassword),
        apiVerified: false,
      } as Partial<BankDetail>,
      { transaction: options.transaction },
    );
  }

  /**
   * Runs the Gatekeeper rules engine for an already-persisted bank detail.
   * Kept separate so it can run *after* a transaction commits (it sends email
   * and routes the application, side effects that must not be rolled back).
   */
  async runGatekeeper(
    applicationId: string,
    bankDetailId: string,
  ): Promise<GatekeeperResult> {
    return this.gatekeeper.evaluate(applicationId, bankDetailId);
  }

  async findByApplication(applicationId: string): Promise<BankDetail[]> {
    return this.bankModel.findAll({ where: { applicationId } });
  }

  async checkBankRoutingNumber(dto: CheckBankRoutingDto) {
    const banned = await this.bannedModel.findOne({
      where: {
        routingNumber: dto.routingNumber,
      },
    });

    if (banned) {
      throw new BadRequestException(
        'The routing number you entered has been restricted and cannot be used to submit a loan application. Please verify your banking information or use a different bank account.',
      );
    }

    return {
      success: true,
      message: 'Routing number is valid.',
    };
  }
}
