import { Injectable } from '@nestjs/common';

@Injectable()
export class DatabaseService {
  get mode() {
    return process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'postgres' : 'local';
  }
}
