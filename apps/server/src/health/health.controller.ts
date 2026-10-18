import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Reports database, Redis and worker status. Returns 503 only when the API itself can't
   * serve requests (database or Redis down); a missing worker is reported as "degraded".
   */
  @Get()
  @ApiOkResponse({ description: 'Status of the API and its dependencies' })
  async get(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.check();
    const { database, redis } = result.checks;
    if (database === 'down' || redis === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
