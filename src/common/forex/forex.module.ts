import { Module, Global } from '@nestjs/common';
import { ForexService } from './forex.service';

@Global()
@Module({
  providers: [ForexService],
  exports: [ForexService],
})
export class ForexModule {}
