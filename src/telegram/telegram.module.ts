import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramController } from './telegram.controller';
import { NluModule } from '../nlu/nlu.module';
import { TransactionModule } from '../transactions/transaction.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [NluModule, TransactionModule, AnalyticsModule],
  controllers: [TelegramController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramModule {}
