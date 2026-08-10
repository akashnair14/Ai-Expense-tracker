import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';

let app: any;

export default async function handler(req: any, res: any) {
  if (!app) {
    app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
      }),
    );
    app.enableCors({
      origin: true,
      credentials: true,
    });
    app.useStaticAssets(join(__dirname, '..', 'public'));
    await app.init();
  }
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp(req, res);
}
