import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'messages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
})
export class Message extends Model<Message> {
  @Column({
    type: DataType.STRING(120),
    allowNull: false,
  })
  full_name!: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  email!: string;

  @Column({
    type: DataType.STRING(15),
    allowNull: false,
  })
  number!: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  subject!: string;

  @Column({
    type: DataType.STRING(250),
    allowNull: false,
  })
  message!: string;
}
