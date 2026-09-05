import { Module } from '@nestjs/common';
import { VectorEmbeddingService } from './vector-embedding.service';

@Module({
  providers: [VectorEmbeddingService],
  exports: [VectorEmbeddingService],
})
export class VectorModule {}
