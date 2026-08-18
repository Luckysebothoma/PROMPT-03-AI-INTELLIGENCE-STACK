'use strict';

const config = require('./config');
const redisClient = require('./redisClient');
const { pool } = require('./db');
const metrics = require('./metrics');

// In-memory authoritative-on-boot registry (rebuilt from Postgres/config if Redis is empty)
let state = {
  providers: [],
  models: [],
  workers: [],
  credentials: []
};

function loadFromConfig() {
  state = {
    providers: config.providers,
    models: config.models,
    workers: config.workers,
    credentials: config.credentials
  };
}

async function loadFromPostgres() {
  const providers = (await pool.query('SELECT config FROM providers')).rows.map((r) => r.config);
  const models = (await pool.query('SELECT config FROM models')).rows.map((r) => r.config);
  const workers = (await pool.query('SELECT config FROM ai_workers')).rows.map((r) => r.config);

  const credRows = (await pool.query('SELECT provider_id, config FROM provider_credentials')).rows;
  const credByProvider = {};
  for (const row of credRows) {
    credByProvider[row.provider_id] = credByProvider[row.provider_id] || [];
    credByProvider[row.provider_id].push(row.config);
  }
  const credentials = Object.keys(credByProvider).map((provider) => ({
    provider,
    credentials: credByProvider[provider]
  }));

  if (providers.length) state.providers = providers;
  if (models.length) state.models = models;
  if (workers.length) state.workers = workers;
  if (credentials.length) state.credentials = credentials;
}

async function cacheRegistry() {
  await redisClient.cacheSet('registry:providers', state.providers, 300);
  await redisClient.cacheSet('registry:models', state.models, 300);
  await redisClient.cacheSet('registry:workers', state.workers, 300);
}

async function bootstrap() {
  // 1. Start from bootstrap config (.env)
  loadFromConfig();
  // 2. Prefer durable Postgres registry if it already has rows (survives restarts / admin edits)
  try {
    await loadFromPostgres();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[REGISTRY] could not load from Postgres, using config defaults:', err.message);
  }
  // 3. Warm Redis cache
  await cacheRegistry();
}

async function refresh() {
  const cachedProviders = await redisClient.cacheGet('registry:providers');
  const cachedModels = await redisClient.cacheGet('registry:models');
  const cachedWorkers = await redisClient.cacheGet('registry:workers');

  if (cachedProviders && cachedModels && cachedWorkers) {
    metrics.redisCacheHits.inc();
    state.providers = cachedProviders;
    state.models = cachedModels;
    state.workers = cachedWorkers;
    return;
  }
  metrics.redisCacheMisses.inc();
  await loadFromPostgres();
  await cacheRegistry();
}

function getProviders() {
  return state.providers;
}

function getProvider(id) {
  return state.providers.find((p) => p.id === id) || null;
}

function getModels() {
  return state.models;
}

function getModel(provider, model) {
  return state.models.find((m) => m.provider === provider && m.model === model) || null;
}

function getWorkers() {
  return state.workers;
}

function getWorker(id) {
  return state.workers.find((w) => w.id === id) || null;
}

function getCredentials(providerId) {
  const entry = state.credentials.find((c) => c.provider === providerId);
  return entry ? entry.credentials : [];
}

function getCapabilities() {
  const caps = new Set();
  for (const m of state.models) {
    for (const c of m.capabilities || []) caps.add(c);
  }
  return Array.from(caps).sort();
}

function isModelSelectable(model, { allowPreview = false } = {}) {
  if (!model.enabled) return false;
  if (model.lifecycle === 'disabled') return false;
  if (model.lifecycle === 'deprecated') return false;
  if (model.lifecycle === 'preview' && !allowPreview) return false;
  return true;
}

// Filter enabled -> filter capability -> filter lifecycle -> sort by priority
function resolveModelsForCapability(capability, opts = {}) {
  return state.models
    .filter((m) => isModelSelectable(m, opts))
    .filter((m) => (m.capabilities || []).includes(capability))
    .filter((m) => {
      const provider = getProvider(m.provider);
      return provider && provider.enabled;
    })
    .sort((a, b) => (a.priority || 999) - (b.priority || 999));
}

function resolveWorkersForCapability(capability) {
  return state.workers
    .filter((w) => w.enabled)
    .filter((w) => (w.capabilities || []).includes(capability))
    .sort((a, b) => (a.priority || 999) - (b.priority || 999));
}

module.exports = {
  bootstrap,
  refresh,
  getProviders,
  getProvider,
  getModels,
  getModel,
  getWorkers,
  getWorker,
  getCredentials,
  getCapabilities,
  resolveModelsForCapability,
  resolveWorkersForCapability,
  isModelSelectable
};
