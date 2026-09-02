import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramWebhookGuard } from './guards/telegram-webhook.guard';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  @Post('webhook')
  @UseGuards(TelegramWebhookGuard)
  async handleWebhook(@Body() update: any) {
    const bot = this.telegramBotService.getBot();
    await bot.handleUpdate(update);
    return { status: 'ok' };
  }
}
