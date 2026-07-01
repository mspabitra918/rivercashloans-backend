import { Column, DataType, Model, Table, HasMany } from 'sequelize-typescript';
import { Application } from '../../applications/models/application.model';

@Table({ tableName: 'users', timestamps: false })
export class User extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({ type: DataType.STRING(100), field: 'first_name' })
  declare firstName: string;

  @Column({ type: DataType.STRING(100), field: 'last_name' })
  declare lastName: string;

  @Column({ type: DataType.STRING(255), unique: true })
  declare email: string;

  @Column({ type: DataType.STRING(20) })
  declare phone: string;

  @Column({ type: DataType.STRING })
  declare dob: string;

  // AES-256-GCM ciphertext — never store or log the raw SSN.
  @Column({ type: DataType.TEXT, field: 'ssn_encrypted' })
  declare ssnEncrypted: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
    field: 'tcpa_consent',
  })
  declare tcpaConsent: boolean;

  @Column({ type: DataType.DATE, field: 'tcpa_timestamp' })
  declare tcpaTimestamp: Date;

  @Column({ type: DataType.STRING(45), field: 'tcpa_ip_address' })
  declare tcpaIpAddress: string;

  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @HasMany(() => Application)
  declare applications: Application[];
}
