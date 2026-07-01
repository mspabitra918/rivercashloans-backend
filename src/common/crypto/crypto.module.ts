import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

// Global so any feature module can inject EncryptionService without re-importing.
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
