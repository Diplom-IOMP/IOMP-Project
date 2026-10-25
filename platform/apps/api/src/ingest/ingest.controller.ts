import { Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiKeyGuard, RequirePermission } from '../auth/api-key.guard';
import { IngestService } from './ingest.service';

@Controller('api/v1')
@UseGuards(ApiKeyGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  // `::` is Fastify's escape for a literal colon in a path.
  @Post('events::ingest')
  @HttpCode(202)
  @RequirePermission('events.ingest')
  async ingestEvents(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.ingest.ingest({
      principal: req.principal!,
      method: req.method,
      path: '/api/v1/events:ingest',
      idempotencyKey: req.headers['idempotency-key'],
      body: req.body,
      rawBody: req.rawBody,
    });
    void reply.status(result.status);
    return result.body;
  }
}
