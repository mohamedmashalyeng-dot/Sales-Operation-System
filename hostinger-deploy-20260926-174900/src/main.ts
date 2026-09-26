import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

process.env.NEST_COMPAT_MODE = 'true';

const legacy = require('../server.js');

function requestPath(req: any): string {
  try {
    return new URL(req.url, `http://${req.headers.host}`).pathname;
  } catch {
    return req.url || '/';
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const express = app.getHttpAdapter().getInstance();

  express.use((req: any, res: any, next: any) => {
    const pathname = requestPath(req);
    if (pathname === '/api/health') {
      return res.status(200).json({
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        database: process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'configured' : 'not_configured'
      });
    }
    if (!pathname.startsWith('/api/')) return next();
    Promise.resolve(legacy.handleApi(req, res)).catch((error: any) => {
      if (res.headersSent) return;
      res.status(error?.status || 500).json({ error: error?.message || 'Server error.' });
    });
  });

  express.use((req: any, res: any) => legacy.serveStatic(req, res));

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`Kent Business College Nest backend running on port ${port}`);
  legacy.startAutoSync();
}

bootstrap();
