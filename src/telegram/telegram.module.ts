import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramController } from './telegram.controller';
import { TelegramIdempotencyService } from './telegram-idempotency.service';
import { NluModule } from '../nlu/nlu.module';
import { TransactionModule } from '../transactions/transaction.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NluModule, TransactionModule, AnalyticsModule, AuthModule],
  controllers: [TelegramController],
  providers: [TelegramBotService, TelegramIdempotencyService],
  exports: [TelegramBotService, TelegramIdempotencyService],
})
export class TelegramModule {}
