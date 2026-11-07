import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramWebhookGuard } from './guards/telegram-webhook.guard';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly telegramBotService: TelegramBotService) {}

  @Post('webhook')
  @UseGuards(TelegramWebhookGuard)
  async handleWebhook(@Body() update: any) {
    try {
      const bot = this.telegramBotService.getBot();
      await bot.handleUpdate(update);
      return { status: 'ok' };
    } catch (err: any) {
      this.logger.error(`Webhook processing error: ${err.message}`, err.stack);
      // Return 200 to Telegram so it doesn't repeatedly retry on failed updates
      return { status: 'error', message: err.message };
    }
  }
}
