import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { migrations } from './migrations';

export const PG_POOL = Symbol('PG_POOL');

@Injectable()
export class Database implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) readonly pool: Pool) {}

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

// The pool connects lazily, so modules that never query need no database.
@Global()
@Module({
  providers: [{ provide: PG_POOL, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) }, Database],
  exports: [Database],
})
export class DatabaseModule {}

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('iomp_migrations'))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((row) => row.id),
    );
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
