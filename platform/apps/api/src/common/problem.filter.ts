import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendProblem } from './http';
import { ProblemError } from './problem';

const CODES: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Bad request'],
  401: ['UNAUTHENTICATED', 'Authentication required'],
  403: ['PERMISSION_DENIED', 'Permission denied'],
  404: ['NOT_FOUND', 'Not found'],
  405: ['METHOD_NOT_ALLOWED', 'Method not allowed'],
  413: ['PAYLOAD_TOO_LARGE', 'Payload too large'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type'],
};

// Every error leaves the API as application/problem+json, without stack traces. This includes
// Fastify errors raised before a handler runs (body limit, media type).
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    sendProblem(req, http.getResponse<FastifyReply>(), this.toProblem(exception, req));
  }

  private toProblem(exception: unknown, req: FastifyRequest): ProblemError {
    if (exception instanceof ProblemError) return exception;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === 'number' && status < 500) {
      if (status === 413 && req.url.startsWith('/api/v1/events:ingest')) {
        return new ProblemError(413, 'BATCH_TOO_LARGE', 'Batch exceeds limits', {
          detail: 'At most 500 events and 5 MiB per batch',
        });
      }
      const [code, title] = CODES[status] ?? CODES[400]!;
      return new ProblemError(status, code, title);
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return new ProblemError(500, 'INTERNAL_ERROR', 'Internal error');
  }
}
