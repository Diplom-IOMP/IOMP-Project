import type { Schemas } from '@iomp/api-types';

export type Problem = Schemas['Problem'];
export type ProblemFieldError = NonNullable<Problem['errors']>[number];

interface ProblemOptions {
  detail?: string;
  errors?: ProblemFieldError[];
  headers?: Record<string, string>;
  retryAfterSeconds?: number;
}

// An RFC 9457 problem (platform spec 8.1). The `type` is derived from `code`:
// IDEMPOTENCY_CONFLICT -> urn:iomp:problem:idempotency-conflict.
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly options: ProblemOptions = {},
  ) {
    super(options.detail ?? title);
  }

  toBody(requestId: string, instance: string): Problem {
    const body: Problem = {
      type: `urn:iomp:problem:${this.code.toLowerCase().replaceAll('_', '-')}`,
      title: this.title,
      status: this.status,
      code: this.code,
      request_id: requestId,
      instance,
    };
    if (this.options.detail !== undefined) body.detail = this.options.detail;
    if (this.options.errors !== undefined) body.errors = this.options.errors;
    if (this.options.retryAfterSeconds !== undefined) body.retry_after_seconds = this.options.retryAfterSeconds;
    return body;
  }

  headers(): Record<string, string> {
    const headers = { ...this.options.headers };
    if (this.options.retryAfterSeconds !== undefined) headers['Retry-After'] = String(this.options.retryAfterSeconds);
    return headers;
  }
}

export function schemaValidationFailed(errors: ProblemFieldError[], detail?: string): ProblemError {
  return new ProblemError(422, 'SCHEMA_VALIDATION_FAILED', 'Request does not match the schema', { detail, errors });
}
