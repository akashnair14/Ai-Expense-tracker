import { Module } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { GroupSplitService } from './group-split.service';

@Module({
  providers: [TransactionService, GroupSplitService],
  exports: [TransactionService, GroupSplitService],
})
export class TransactionModule {}
