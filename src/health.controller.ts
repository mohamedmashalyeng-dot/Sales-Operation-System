import { Controller, Get } from '@nestjs/common';

@Controller('api/health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      database: process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'configured' : 'not_configured'
    };
  }
}
