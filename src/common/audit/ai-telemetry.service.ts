import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordAIPredictionParams {
  rawPrompt: string;
  provider: string;
  responseMetadata?: Record<string, any>;
  tokensUsed?: number;
  latencyMs: number;
}

@Injectable()
export class AITelemetryService {
  private static instancePrisma: PrismaService | null = null;
  private readonly logger = new Logger(AITelemetryService.name);

  constructor(private readonly prisma: PrismaService) {
    AITelemetryService.instancePrisma = prisma;
  }

  public static async record(params: RecordAIPredictionParams): Promise<void> {
    if (!AITelemetryService.instancePrisma) return;
    try {
      await AITelemetryService.instancePrisma.aIPrediction.create({
        data: {
          rawPrompt: (params.rawPrompt || '').slice(0, 1000),
          provider: params.provider,
          responseMetadata: params.responseMetadata || {},
          tokensUsed: params.tokensUsed || 0,
          latencyMs: params.latencyMs || 0,
        },
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  public async recordPrediction(params: RecordAIPredictionParams): Promise<void> {
    return AITelemetryService.record(params);
  }
}
