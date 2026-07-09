import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { BankDetailsService } from './bank-details.service';
import {
  CheckBankRoutingDto,
  CreateBankDetailDto,
} from './dto/create-bank-detail.dto';
import { UpdateBankDetailDto } from './dto/update-bank-detail.dto';

@Controller('bank-details')
export class BankDetailsController {
  constructor(private readonly bankDetailsService: BankDetailsService) {}

  // Step 4 of the funnel; submitting bank details runs the Gatekeeper.
  @Post()
  async create(@Body() dto: CreateBankDetailDto) {
    return this.bankDetailsService.create(dto);
  }

  // BANK_REJECTED correction flow: update the existing bank record in place and
  // re-run the Gatekeeper. Keyed by applicationId so the customer portal (which
  // holds the application id, not the bank-detail id) can call it directly.
  @Patch('application/:applicationId')
  async update(
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateBankDetailDto,
  ) {
    return this.bankDetailsService.update(applicationId, dto);
  }

  @Post('check-routing')
  async checkRouting(@Body() dto: CheckBankRoutingDto) {
    return this.bankDetailsService.checkBankRoutingNumber(dto);
  }
}
