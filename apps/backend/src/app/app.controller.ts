import { Controller, Get } from '@nestjs/common';
import { AppService, HealthResponse } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/live')
  getLiveness(): HealthResponse {
    return this.appService.getLiveness();
  }

  @Get('health/ready')
  async getReadiness(): Promise<HealthResponse> {
    return await this.appService.getReadiness();
  }
}
