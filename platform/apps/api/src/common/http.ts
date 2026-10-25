import { randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform, type Readable } from 'node:stream';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProblemError } from './problem';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    correlationId: string;
    rawBody?: Buffer;
  }
}

export const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_DECOMPRESSION_RATIO = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Body that is not valid JSON. Handlers turn it into the problem their contract asks for.
export const INVALID_JSON = Symbol('INVALID_JSON');

// Nest must not register its own JSON parser: configureApp() installs one that keeps the raw body.
export const appOptions = { bodyParser: false } as const;

export function createAdapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: MAX_BODY_BYTES });
}

export function sendProblem(req: FastifyRequest, reply: FastifyReply, problem: ProblemError): void {
  void reply
    .status(problem.status)
    .headers(problem.headers())
    .type('application/problem+json')
    .send(problem.toBody(req.requestId, req.url.split('?')[0] ?? req.url));
}

// Wires request ids, the JSON body parser and gzip decoding. Errors from these hooks reach
// ProblemFilter like any other. Used by main.ts and by tests.
export function configureApp(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.decorateRequest('requestId', '');
  fastify.decorateRequest('correlationId', '');
  fastify.addHook('onRequest', async (req, reply) => {
    req.requestId = randomUUID();
    const incoming = req.headers['x-correlation-id'];
    req.correlationId = typeof incoming === 'string' && UUID.test(incoming) ? incoming : randomUUID();
    void reply.header('X-Correlation-ID', req.correlationId);
  });

  fastify.addHook('preParsing', async (req, _reply, payload) => decodeBody(req, payload));

  // JSON only (platform spec 8.1): any other media type is 415.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const raw = body as Buffer;
    req.rawBody = raw;
    try {
      done(null, raw.length === 0 ? undefined : JSON.parse(raw.toString('utf8')));
    } catch {
      done(null, INVALID_JSON);
    }
  });
}

// Content-Encoding: gzip with a 20:1 decompression ratio limit (contract limits). The decoded
// size is capped by Fastify's bodyLimit, which counts the stream returned here.
function decodeBody(req: FastifyRequest, payload: Readable): Readable {
  const encoding = (req.headers['content-encoding'] ?? 'identity').toLowerCase().trim();
  if (encoding === 'identity') return payload;
  if (encoding !== 'gzip') {
    throw new ProblemError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding', {
      detail: 'Content-Encoding must be gzip or identity',
    });
  }

  const declared = Number(req.headers['content-length']);
  let encoded = 0;
  let decoded = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      encoded += chunk.length;
      callback(null, chunk);
    },
  });
  const ratioGuard = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      decoded += chunk.length;
      const base = Number.isFinite(declared) && declared > 0 ? declared : encoded;
      if (decoded > base * MAX_DECOMPRESSION_RATIO) {
        callback(
          new ProblemError(413, 'BATCH_TOO_LARGE', 'Batch exceeds limits', {
            detail: 'Decompression ratio exceeds 20:1',
          }),
        );
        return;
      }
      callback(null, chunk);
    },
  });

  const gunzip = createGunzip();
  for (const stream of [payload, counter, gunzip]) {
    stream.on('error', (err) => ratioGuard.destroy(err instanceof ProblemError ? err : badGzip()));
  }
  payload.pipe(counter).pipe(gunzip).pipe(ratioGuard);
  // Fastify compares Content-Length with the bytes read from the wire, not the decoded size.
  Object.defineProperty(ratioGuard, 'receivedEncodedLength', { get: () => encoded });
  return ratioGuard;
}

function badGzip(): ProblemError {
  return new ProblemError(400, 'BAD_REQUEST', 'Bad request', { detail: 'Body is not valid gzip' });
}
