import { Controller, Get } from '@nestjs/common'; // FIX: Nest controller + route decorator
import { Public } from './auth/decorators/public.decorator'; // FIX: bypass JWT for probes

@Controller() // FIX: routes sit under global prefix `api` → GET /api, GET /api/live
export class AppController {
  // FIX: root health check — prevents 404 on GET /api (global prefix)
  @Public() // FIX: public
  @Get() // FIX: empty path → /api
  root() {
    return {
      status: 'ok', // FIX
      app: 'PermaTrax API', // FIX
      version: '1.0.0', // FIX
      time: new Date().toISOString(), // FIX
    };
  }

  // FIX: lightweight process probe — NOT /api/health (that path is HealthModule + Dockerfile HEALTHCHECK)
  @Public() // FIX: public
  @Get('live') // FIX: GET /api/live — uptime + memory for quick monitoring
  live() {
    return {
      status: 'healthy', // FIX
      uptime: process.uptime(), // FIX
      memory: process.memoryUsage(), // FIX
      time: new Date().toISOString(), // FIX
    };
  }
}
