import { Module, forwardRef } from '@nestjs/common';
import { NluService } from './nlu.service';
import { ConversationContextService } from './services/conversation-context.service';
import { ToolDispatcherService } from './services/tool-dispatcher.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { TransactionModule } from '../transactions/transaction.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AnalyticsModule),
    forwardRef(() => TransactionModule),
  ],
  providers: [NluService, ConversationContextService, ToolDispatcherService],
  exports: [NluService, ConversationContextService, ToolDispatcherService],
})
export class NluModule {}

