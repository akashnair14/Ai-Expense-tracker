import { Controller, Get, Res } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';
import { AppService } from './app.service';
import { ForexService } from './common/forex/forex.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly forexService: ForexService,
  ) {}

  @Get(['', 'login', 'signup', 'register', 'app', 'dashboard', 'onboarding'])
  serveApp(@Res() res: express.Response) {
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  }

  @Get('api/forex/rates')
  async getForexRates() {
    await this.forexService.refreshRates();
    return {
      base: 'USD',
      rates: this.forexService.getAllRates(),
    };
  }

  @Get('api/hello')
  getHello(): string {
    return this.appService.getHello();
  }
}
