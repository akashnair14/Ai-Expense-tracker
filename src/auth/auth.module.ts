import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { TransactionModule } from '../transactions/transaction.module';

@Module({
  imports: [
    PrismaModule,
    TransactionModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret =
          config.get<string>('SESSION_SECRET') ||
          config.get<string>('JWT_SECRET');

        if (!secret && config.get<string>('NODE_ENV') === 'production') {
          throw new Error('CRITICAL: JWT_SECRET or SESSION_SECRET must be defined in production');
        }

        return {
          secret: secret || 'pulseai_jwt_secret_key_2026_super_secure',
          signOptions: { expiresIn: '30d' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, OptionalJwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, OptionalJwtAuthGuard, JwtModule],
})
export class AuthModule {}
