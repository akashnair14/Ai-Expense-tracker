import { Module } from '@nestjs/common';
import { NluService } from './nlu.service';

@Module({
  providers: [NluService],
  exports: [NluService],
})
export class NluModule {}
