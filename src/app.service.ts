import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      service: 'rivercash-backend',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
