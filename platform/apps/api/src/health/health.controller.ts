import { Controller, Get } from '@nestjs/common';

// Internal probes (platform spec 8.2: GET /livez and GET /readyz), no application secrets.
@Controller()
export class HealthController {
  @Get('livez')
  livez(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  readyz(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
