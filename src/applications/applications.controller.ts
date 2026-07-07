import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApplicationsService } from './applications.service';
// import { CreateApplicationDto } from './dto/create-application.dto';
import { CreateLoanApplicationDto } from './dto/create-loan-application.dto';
import { CreateExistingUserLoanApplicationDto } from './dto/create-existing-user-loan-application.dto';
import { STATUS_TO_STAGE } from '../common/lifecycle';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../common/constants';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  // @Post()
  // async create(@Body() dto: CreateApplicationDto) {
  //   const app = await this.applicationsService.create(dto);
  //   return this.toStatusView(app);
  // }

  @Post('/loan-applications')
  async createLoanApplications(
    @Body() body: CreateLoanApplicationDto,
    @Ip() ip: string,
  ) {
    const app = await this.applicationsService.createLoanApplications(
      body.user,
      body.application,
      body.bank,
      ip,
    );
    return this.toStatusView(app);
  }

  // Returning-user flow: an authenticated applicant starts another loan without
  // re-entering (or being able to change) their personal details. Only the
  // application and bank information are collected; the user is referenced by id.
  @Post('/loan-applications/existing')
  async createLoanApplicationForExistingUser(
    @Body() body: CreateExistingUserLoanApplicationDto,
  ) {
    const app =
      await this.applicationsService.createLoanApplicationForExistingUser(
        body.userId,
        body.application,
        body.bank,
      );
    return this.toStatusView(app);
  }

  // Drives the customer dashboard list: every application belonging to a user,
  // most recent first. We only have the user id (from the JWT/session) here.
  @Get('user/applications/:phone')
  @UseGuards(JwtAuthGuard)
  async findAllApplicationByUser(
    @Param('phone') phone: string,
    @CurrentUser() user: AuthUser,
  ) {
    const apps = await this.applicationsService.findAllApplicationByUser(phone);
    // A customer may only list their own applications; staff may list anyone's.
    if (apps.length > 0) this.assertCanAccess(user, apps[0].userId);
    return apps.map((app) => ({
      ...this.toStatusView(app),
      loanPurpose: app.loanPurpose,
      createdAt: app.createdAt,
    }));
  }

  // Drives the customer dashboard after OTP login, where we only have the user
  // id (from the JWT/session) rather than a specific application id.
  @Get('user/:phone')
  @UseGuards(JwtAuthGuard)
  async findLatestByUser(
    @Param('phone') phone: string,
    @CurrentUser() user: AuthUser,
  ) {
    const app = await this.applicationsService.findLatestByPhone(phone);
    this.assertCanAccess(user, app.userId);
    return this.toStatusView(app);
  }

  // Drives the customer dashboard lifecycle tracker. Requires a valid session,
  // and a customer may only view an application they own (prevents IDOR via a
  // guessed/leaked `?id=` in the dashboard URL).
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const app = await this.applicationsService.findById(id);
    this.assertCanAccess(user, app.userId);
    return this.toStatusView(app);
  }

  // Ownership gate shared by the customer-facing read endpoints. Staff
  // (admin/underwriter) may access any application; a customer may only access
  // applications whose owner id matches their token subject.
  private assertCanAccess(user: AuthUser, ownerId: string): void {
    if ((user.role as Role) !== Role.CUSTOMER) return;
    if (ownerId !== user.sub) {
      throw new ForbiddenException(
        'You do not have access to this application.',
      );
    }
  }

  @Post(':id/esign')
  async esign(
    @Param('id') id: string,
    @Ip() ip: string,
    @Body() body: { fullName?: string } = {},
  ) {
    const { application, signedAt, signedName } =
      await this.applicationsService.esign(id, ip, body?.fullName);
    return {
      ...this.toStatusView(application),
      signed_at: signedAt.toISOString(),
      signed_name: signedName,
    };
  }

  // Public — the applicant fetches a short-lived signed URL to view their
  // generated loan agreement from the status portal.
  @Get('applications/:application_id/agreement')
  async getAgreement(@Param('application_id') application_id: string) {
    try {
      const agreement =
        await this.applicationsService.getAgreement(application_id);
      return { agreement };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching loan agreement',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private toStatusView(app: {
    id: string;
    status: string;
    requestedAmount: number;
    loanTermMonths: number;
    monthlyPayment: number;
    calculatedDti: number;
    statusReason?: string;
    loanAgreement?: { signedAt?: Date | null } | null;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    };
  }) {
    const stage = STATUS_TO_STAGE[app.status] ?? {
      index: -1,
      label: app.status,
    };
    return {
      id: app.id,
      status: app.status,
      statusReason: app.statusReason ?? null,
      stageIndex: stage.index,
      stageLabel: stage.label,
      // True once the borrower has e-signed. The status stays
      // SIGN_LOAN_AGREEMENT afterward (signed, awaiting a manual fund release),
      // so the portal reads this to mark the "Sign Agreement" stage complete.
      esign: !!app.loanAgreement?.signedAt,
      borrowerName: `${app?.user?.firstName} ${app?.user?.lastName}`,
      requestedAmount: Number(app.requestedAmount),
      loanTermMonths: app.loanTermMonths,
      monthlyPayment: Number(app.monthlyPayment),
      calculatedDti: Number(app.calculatedDti),
      user: app.user,
    };
  }
}
