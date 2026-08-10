import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 1. Enable Security Headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable default CSP to allow inline styles/scripts for demo dashboard
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 2. Enable CORS
  const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';
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
