import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { RecurringService } from './recurring.service';
import { TransactionModule } from '../transactions/transaction.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TransactionModule, AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, RecurringService],
  exports: [AnalyticsService, RecurringService],
})
export class AnalyticsModule {}
