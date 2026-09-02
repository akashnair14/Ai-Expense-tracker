import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';

async function bootstrap() {
  // Initialize Sentry if SENTRY_DSN is configured in environment
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 1.0,
    });
    console.log('🛡️ Sentry Error Tracking initialized successfully.');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Global Sentry and Error Handling Filter
  app.useGlobalFilters(new SentryExceptionFilter());

  // 1. Enable Security Headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 2. Enable CORS
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : '*';
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // 3. Serve static UI assets from public folder
  app.useStaticAssets(join(__dirname, '..', 'public'));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`\n======================================================`);
  console.log(`🚀 EXPENSE TRACKER SECURED BACKEND & DASHBOARD IS RUNNING!`);
  console.log(`🌐 Open Web Dashboard: http://localhost:${port}`);
  console.log(`======================================================\n`);
}
bootstrap();
