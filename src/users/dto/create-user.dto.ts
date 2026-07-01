import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  // @Matches(/^(0[1-9]|1[0-2])[/-](0[1-9]|[12][0-9]|3[01])[/-]\d{4}$/, {
  //   message: 'dob must be MM/DD/YYYY or MM-DD-YYYY',
  // })
  // @Transform(({ value }) => {
  //   if (!value) return value;

  //   const [month, day, year] = value.split(/[/-]/);
  //   return `${year}-${month}-${day}`;
  // })
  dob?: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  state!: string;

  @IsString()
  @IsNotEmpty()
  zipCode!: string;

  // Raw SSN — encrypted at rest, never persisted in plaintext.
  @IsOptional()
  @IsString()
  @Length(9, 11)
  ssn?: string;

  // TCPA consent must be explicitly true to proceed.
  @IsBoolean()
  tcpaConsent!: boolean;
}
