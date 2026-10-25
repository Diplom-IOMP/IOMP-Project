import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { API_KEY_MAX_DAYS, generateApiKey } from '../auth/api-keys';
import { runMigrations } from '../db/database';

// Admin CLI until IAM and the HTTP admin API exist (#31). Writes straight to DATABASE_URL.
//   pnpm admin create-source --name <name> --type <type> [--id <uuid>] [--rate <events/s>] [--burst <n>]
//   pnpm admin create-account --name <name> --permissions events.ingest,ci.write --sources <id>[,<id>]
//   pnpm admin create-key --account <id> [--days 90]
//   pnpm admin revoke-key --prefix <prefix>

const USAGE = `Usage: admin <command> [options]
  create-source   --name <name> --type <type> [--id <uuid>] [--rate <events/s>] [--burst <n>] [--interval <s>]
  create-account  --name <name> --permissions <p1,p2> --sources <id1,id2>
  create-key      --account <id> [--days <1-${API_KEY_MAX_DAYS}>]
  revoke-key      --prefix <prefix>`;

const options = {
  name: { type: 'string' },
  type: { type: 'string' },
  id: { type: 'string' },
  rate: { type: 'string' },
  burst: { type: 'string' },
  interval: { type: 'string' },
  permissions: { type: 'string' },
  sources: { type: 'string' },
  account: { type: 'string' },
  days: { type: 'string' },
  prefix: { type: 'string' },
} as const;

export class UsageError extends Error {}

function required(values: Record<string, string | undefined>, name: string): string {
  const value = values[name];
  if (!value) throw new UsageError(`--${name} is required`);
  return value;
}

function positiveInt(value: string | undefined, name: string, fallback: number, max = Infinity): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new UsageError(`--${name} must be an integer from 1 to ${max}`);
  return n;
}

const list = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

// Runs one command and returns what to print. Throws UsageError for bad arguments.
export async function runAdmin(argv: string[], pool: Pool): Promise<string> {
  const { positionals, values } = parseArgs({ args: argv, options, allowPositionals: true });
  const [command] = positionals;

  switch (command) {
    case 'create-source': {
      const id = values.id ?? randomUUID();
      const burst = positiveInt(values.burst, 'burst', 500);
      await pool.query(
        `INSERT INTO data_sources (id, name, type, expected_interval_seconds, quota_events_per_second, quota_burst, quota_tokens)
         VALUES ($1, $2, $3, $4, $5, $6::integer, $6::integer)`,
        [
          id,
          required(values, 'name'),
          required(values, 'type'),
          positiveInt(values.interval, 'interval', 60),
          positiveInt(values.rate, 'rate', 100),
          burst,
        ],
      );
      return `source ${id}`;
    }
    case 'create-account': {
      const id = randomUUID();
      const sources = list(required(values, 'sources'));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO service_accounts (id, name, permissions) VALUES ($1, $2, $3)', [
          id,
          required(values, 'name'),
          list(required(values, 'permissions')),
        ]);
        for (const source of sources) {
          await client.query('INSERT INTO service_account_sources VALUES ($1, $2)', [id, source]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return `account ${id}`;
    }
    case 'create-key': {
      const days = positiveInt(values.days, 'days', API_KEY_MAX_DAYS, API_KEY_MAX_DAYS);
      const { key, prefix, secretSha256 } = generateApiKey();
      await pool.query(
        `INSERT INTO api_keys (id, service_account_id, prefix, secret_sha256, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
        [randomUUID(), required(values, 'account'), prefix, secretSha256, days],
      );
      return `key ${key}\n(shown once; expires in ${days} days)`;
    }
    case 'revoke-key': {
      const { rowCount } = await pool.query(
        'UPDATE api_keys SET revoked_at = now() WHERE prefix = $1 AND revoked_at IS NULL',
        [required(values, 'prefix')],
      );
      if (rowCount === 0) throw new UsageError('no active key with this prefix');
      return 'revoked';
    }
    default:
      throw new UsageError(command ? `unknown command ${command}` : 'command is required');
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await runMigrations(pool);
    console.log(await runAdmin(process.argv.slice(2), pool));
  } catch (error) {
    console.error(error instanceof UsageError ? `${error.message}\n\n${USAGE}` : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) void main();
