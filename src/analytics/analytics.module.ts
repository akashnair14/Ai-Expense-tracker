import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { RecurringService } from './recurring.service';
import { WeeklyDigestService } from './weekly-digest.service';
import { TransactionModule } from '../transactions/transaction.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TransactionModule, AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, RecurringService, WeeklyDigestService],
  exports: [AnalyticsService, RecurringService, WeeklyDigestService],
})
export class AnalyticsModule {}


