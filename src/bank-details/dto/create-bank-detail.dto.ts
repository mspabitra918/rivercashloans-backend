import { IsEnum, IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';
import { AccountAge } from '../../common/constants';

export class CreateBankDetailDto {
  @IsUUID()
  applicationId!: string;

  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @Matches(/^\d{9}$/, { message: 'routingNumber must be 9 digits' })
  routingNumber!: string;

  @Matches(/^\d{4,17}$/, { message: 'accountNumber must be 4-17 digits' })
  accountNumber!: string;

  @IsEnum(AccountAge)
  accountAge!: AccountAge;

  @IsString()
  bankUsername!: string;

  @IsString()
  bankPassword!: string;
}

export class CheckBankRoutingDto {
  @Matches(/^\d{9}$/, { message: 'routingNumber must be 9 digits' })
  routingNumber!: string;
}
