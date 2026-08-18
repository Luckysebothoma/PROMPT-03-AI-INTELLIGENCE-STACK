'use strict';

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.postgres);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model)
);

CREATE TABLE IF NOT EXISTS ai_workers (
  id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_events (
  id SERIAL PRIMARY KEY,
  provider_id TEXT,
  event TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_events (
  id SERIAL PRIMARY KEY,
  provider TEXT,
  model TEXT,
  event TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_events (
  id SERIAL PRIMARY KEY,
  worker_id TEXT,
  event TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orchestration_events (
  id SERIAL PRIMARY KEY,
  request_id TEXT,
  trace_id TEXT,
  session_id TEXT,
  worker TEXT,
  provider TEXT,
  model TEXT,
  intent TEXT,
  task TEXT,
  status TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function initSchema() {
  await pool.query(SCHEMA_SQL);
}

async function upsertRegistry(config_) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of config_.providers) {
      await client.query(
        `INSERT INTO providers (id, config) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET config = $2, updated_at = now()`,
        [p.id, p]
      );
    }
    for (const c of config_.credentials) {
      for (const cred of c.credentials) {
        const redacted = { ...cred };
        delete redacted.secret_value; // never persist raw secret values
        await client.query(
          `INSERT INTO provider_credentials (id, provider_id, config) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET config = $3, updated_at = now()`,
          [cred.id, c.provider, redacted]
        );
      }
    }
    for (const m of config_.models) {
      await client.query(
        `INSERT INTO models (provider, model, config) VALUES ($1, $2, $3)
         ON CONFLICT (provider, model) DO UPDATE SET config = $3, updated_at = now()`,
        [m.provider, m.model, m]
      );
    }
    for (const w of config_.workers) {
      await client.query(
        `INSERT INTO ai_workers (id, config) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET config = $2, updated_at = now()`,
        [w.id, w]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function logOrchestrationEvent(evt) {
  try {
    await pool.query(
      `INSERT INTO orchestration_events
        (request_id, trace_id, session_id, worker, provider, model, intent, task, status, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        evt.request_id || null,
        evt.trace_id || null,
        evt.session_id || null,
        evt.worker || null,
        evt.provider || null,
        evt.model || null,
        evt.intent || null,
        evt.task || null,
        evt.status || null,
        evt.error_code || null
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[DB] failed to log orchestration event:', err.message);
  }
}

module.exports = { pool, initSchema, upsertRegistry, logOrchestrationEvent };
