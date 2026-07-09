import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UsersModule } from './users/users.module';
import { ApplicationsModule } from './applications/applications.module';
import { BankDetailsModule } from './bank-details/bank-details.module';
import { UnderwritingModule } from './underwriting/underwriting.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { TrackingModule } from './tracking/tracking.module';
import { MessagesModule } from './messages/message.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CryptoModule,
    NotificationsModule,
    UsersModule,
    ApplicationsModule,
    BankDetailsModule,
    UnderwritingModule,
    AuthModule,
    AdminModule,
    TrackingModule,
    MessagesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
