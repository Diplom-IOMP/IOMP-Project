// Schema migrations, applied in order by runMigrations(). Never edit an applied migration;
// add a new one instead.
export const migrations: { id: string; sql: string }[] = [
  {
    id: '001_ingest',
    sql: `
      CREATE TABLE data_sources (
        id uuid PRIMARY KEY,
        name text NOT NULL UNIQUE,
        type text NOT NULL,
        expected_interval_seconds integer NOT NULL DEFAULT 60,
        -- Ingest quota as a token bucket (platform spec 8.1, TEST-023).
        quota_events_per_second integer NOT NULL DEFAULT 100 CHECK (quota_events_per_second > 0),
        quota_burst integer NOT NULL DEFAULT 500 CHECK (quota_burst > 0),
        quota_tokens double precision NOT NULL DEFAULT 500,
        quota_refilled_at timestamptz NOT NULL DEFAULT now(),
        last_event_at timestamptz,
        last_heartbeat_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE service_accounts (
        id uuid PRIMARY KEY,
        name text NOT NULL UNIQUE,
        permissions text[] NOT NULL DEFAULT '{}',
        disabled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE service_account_sources (
        service_account_id uuid NOT NULL REFERENCES service_accounts (id) ON DELETE CASCADE,
        data_source_id uuid NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
        PRIMARY KEY (service_account_id, data_source_id)
      );

      -- Key format iomp_<prefix>_<secret>; only the SHA-256 of the secret is stored.
      CREATE TABLE api_keys (
        id uuid PRIMARY KEY,
        service_account_id uuid NOT NULL REFERENCES service_accounts (id) ON DELETE CASCADE,
        prefix text NOT NULL UNIQUE,
        secret_sha256 bytea NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- Idempotency ledger: scope is principal + method + path, TTL 7 days (platform spec 8.1).
      CREATE TABLE idempotency_records (
        principal_id uuid NOT NULL,
        method text NOT NULL,
        path text NOT NULL,
        key text NOT NULL,
        request_sha256 bytea NOT NULL,
        status_code integer NOT NULL,
        response_body jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        PRIMARY KEY (principal_id, method, path, key)
      );

      -- Accepted input events. The unique key is the delivery dedup key.
      CREATE TABLE events (
        event_id uuid PRIMARY KEY,
        source_id uuid NOT NULL REFERENCES data_sources (id),
        source_event_id text NOT NULL,
        source_revision text NOT NULL DEFAULT '',
        receipt_id uuid NOT NULL,
        event_type text NOT NULL,
        severity text NOT NULL,
        status text NOT NULL,
        source_object_id text,
        condition_id text,
        fingerprint text NOT NULL,
        occurred_at timestamptz NOT NULL,
        ingested_at timestamptz NOT NULL,
        late boolean NOT NULL,
        payload jsonb NOT NULL,
        UNIQUE (source_id, source_event_id, source_revision)
      );
      CREATE INDEX events_fingerprint_idx ON events (fingerprint, occurred_at);
    `,
  },
];
