'use strict';

const express = require('express');
const config = require('./config');
const db = require('./db');
const redisClient = require('./redisClient');
const registry = require('./registry');
const routes = require('./routes');

async function main() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Basic request/trace logging (never logs secrets)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start
      }));
    });
    next();
  });

  // 1. Postgres: durable registry + fail fast if unreachable at boot
  try {
    await db.initSchema();
    await db.upsertRegistry(config);
    // eslint-disable-next-line no-console
    console.log('[BOOT] PostgreSQL schema ready and registry seeded.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[BOOT FATAL] PostgreSQL unavailable or schema init failed:', err.message);
    process.exit(1);
  }

  // 2. Redis: best-effort cache, non-fatal if unavailable
  await redisClient.connect();

  // 3. Load registry (config -> postgres -> redis cache)
  await registry.bootstrap();

  app.use('/', routes);

  app.use((req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown route', retryable: false } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[UNCAUGHT]', err);
    res.status(500).json({ success: false, error: { code: 'UNKNOWN_ERROR', message: 'Internal server error', retryable: false } });
  });

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[BOOT] AI Gateway Day 5 listening on port ${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`[BOOT] Day 3 (provider execution): ${config.day3Url}`);
    // eslint-disable-next-line no-console
    console.log(`[BOOT] Day 4 (context/session):    ${config.day4Url}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[BOOT FATAL]', err);
  process.exit(1);
});
