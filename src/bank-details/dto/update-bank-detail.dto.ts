import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateBankDetailDto } from './create-bank-detail.dto';

// Used by the BANK_REJECTED correction flow (PATCH). Every field is optional
// and the owning applicationId comes from the route, not the body — so the
// applicant can resubmit a corrected account without re-creating the record.
export class UpdateBankDetailDto extends PartialType(
  OmitType(CreateBankDetailDto, ['applicationId'] as const),
) {}
