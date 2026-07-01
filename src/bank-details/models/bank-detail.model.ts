import {
  Column,
  DataType,
  Model,
  Table,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../users/models/user.model';
import { Application } from '../../applications/models/application.model';

@Table({ tableName: 'bank_details', timestamps: false })
export class BankDetail extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, field: 'user_id' })
  declare userId: string;

  @ForeignKey(() => Application)
  @Column({ type: DataType.UUID, field: 'application_id' })
  declare applicationId: string;

  @Column({ type: DataType.STRING, field: 'bank_name' })
  declare bankName: string;

  @Column({ type: DataType.STRING(9), field: 'routing_number' })
  declare routingNumber: string;

  @Column({ type: DataType.STRING, field: 'bank_username' })
  declare bankUsername: string;

  @Column({ type: DataType.STRING, field: 'bank_password' })
  declare bankPassword: string;

  // AES-256-GCM ciphertext — never store or log the raw account number.
  @Column({ type: DataType.TEXT, field: 'account_number_encrypted' })
  declare accountNumberEncrypted: string;

  @Column({ type: DataType.STRING(50), field: 'account_age' })
  declare accountAge: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
    field: 'api_verified',
  })
  declare apiVerified: boolean;

  @BelongsTo(() => Application)
  declare application: Application;
}
