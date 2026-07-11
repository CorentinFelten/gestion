import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  // GET /api/v1/health, liveness probe (used by the Docker healthcheck / Caddy).
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
