import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MessagesController } from './message.controller';
import { Message } from './models/message.entity';
import { MessageService } from './message.service';

@Module({
  imports: [SequelizeModule.forFeature([Message])],
  controllers: [MessagesController],
  providers: [MessageService],
})
export class MessagesModule {}
