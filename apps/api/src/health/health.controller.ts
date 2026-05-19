import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health — selalu 200; degraded jika layanan bermasalah' })
  async get(@Res({ passthrough: true }) res: Response) {
    const body = await this.health.checkLiveness();
    res.status(HttpStatus.OK);
    return body;
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness — 503 jika DB/Redis down' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const { ok, live } = await this.health.checkReadiness();
    if (!ok) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return live;
    }
    res.status(HttpStatus.OK);
    return live;
  }
}
