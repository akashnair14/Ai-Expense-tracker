import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AITelemetryService } from './ai-telemetry.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService, AITelemetryService],
  exports: [AuditService, AITelemetryService],
})
export class AuditModule {}
