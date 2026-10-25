import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { CLOCK, type Clock } from '../common/clock';
import { ProblemError } from '../common/problem';
import { Database } from '../db/database';
import { hashSecret } from './api-keys';

export interface Principal {
  serviceAccountId: string;
  permissions: string[];
  sourceIds: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

const PERMISSION = 'iomp:permission';
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION, permission);

const KEY_FORMAT = /^iomp_([A-Za-z0-9]+)_(\S+)$/;

// Service account API key (ADR-CT-001, GAP-AG-001): header X-API-Key: iomp_<prefix>_<secret>.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly db: Database,
    private readonly reflector: Reflector,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = await this.authenticate(req.headers['x-api-key']);
    const permission = this.reflector.get<string | undefined>(PERMISSION, context.getHandler());
    if (permission !== undefined && !principal.permissions.includes(permission)) {
      throw new ProblemError(403, 'PERMISSION_DENIED', 'Permission denied', {
        detail: `Permission ${permission} is required`,
      });
    }
    req.principal = principal;
    return true;
  }

  private async authenticate(header: string | string[] | undefined): Promise<Principal> {
    const match = typeof header === 'string' ? KEY_FORMAT.exec(header) : null;
    if (!match) throw unauthenticated();
    const [, prefix, secret] = match as unknown as [string, string, string];

    const { rows } = await this.db.pool.query<{
      service_account_id: string;
      secret_sha256: Buffer;
      permissions: string[];
      source_ids: string[];
    }>(
      `SELECT k.service_account_id, k.secret_sha256, sa.permissions,
              array_remove(array_agg(sas.data_source_id::text), NULL) AS source_ids
         FROM api_keys k
         JOIN service_accounts sa ON sa.id = k.service_account_id
         LEFT JOIN service_account_sources sas ON sas.service_account_id = sa.id
        WHERE k.prefix = $1 AND k.revoked_at IS NULL AND k.expires_at > $2 AND sa.disabled_at IS NULL
        GROUP BY k.id, sa.id`,
      [prefix, this.clock.now()],
    );
    const key = rows[0];
    const digest = hashSecret(secret);
    if (!key || !timingSafeEqual(digest, key.secret_sha256)) throw unauthenticated();
    return { serviceAccountId: key.service_account_id, permissions: key.permissions, sourceIds: key.source_ids };
  }
}

function unauthenticated(): ProblemError {
  return new ProblemError(401, 'UNAUTHENTICATED', 'Authentication required', {
    detail: 'Missing, invalid, expired or revoked API key',
  });
}
