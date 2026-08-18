'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const registry = require('./registry');
const resolver = require('./resolver');
const classifier = require('./classifier');
const validator = require('./validator');
const day3Client = require('./day3Client');
const day4Client = require('./day4Client');
const db = require('./db');
const redisClient = require('./redisClient');
const metrics = require('./metrics');
const { ERROR_CODES, sendError } = require('./errors');

const router = express.Router();

function extractText(data) {
  return classifier.extractText(data);
}

// ---------------------------------------------------------------------
// Health / meta endpoints
// ---------------------------------------------------------------------

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ai-gateway-day5', time: new Date().toISOString() });
});

router.get('/ready', async (req, res) => {
  let pgOk = false;
  try {
    await db.pool.query('SELECT 1');
    pgOk = true;
  } catch (err) {
    pgOk = false;
  }
  const redisOk = redisClient.isConnected();
  const ready = pgOk; // Redis is a cache, not a hard dependency for readiness
  res.status(ready ? 200 : 503).json({ ready, postgres: pgOk, redis: redisOk });
});

router.get('/dependencies', async (req, res) => {
  const [day3Up, day4Up] = await Promise.all([day3Client.isAvailable(), day4Client.isAvailable()]);
  let pgOk = false;
  try {
    await db.pool.query('SELECT 1');
    pgOk = true;
  } catch (err) {
    pgOk = false;
  }
  res.json({
    postgres: pgOk,
    redis: redisClient.isConnected(),
    day3: { url: config.day3Url, available: day3Up },
    day4: { url: config.day4Url, available: day4Up }
  });
});

router.get('/help', (req, res) => {
  res.json({
    service: 'AI Gateway Day 5 - AI Intelligence / Task Routing / Provider & Model Orchestration',
    endpoints: [
      'GET /health', 'GET /ready', 'GET /dependencies', 'GET /help', 'GET /metrics',
      'POST /v1/chat', 'POST /v1/classify', 'POST /v1/resolve', 'POST /v1/execute',
      'GET /v1/providers', 'GET /v1/providers/:provider',
      'GET /v1/models', 'GET /v1/models/:model',
      'GET /v1/workers', 'GET /v1/workers/:worker',
      'GET /v1/capabilities'
    ]
  });
});

router.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// ---------------------------------------------------------------------
// Registry endpoints
// ---------------------------------------------------------------------

router.get('/v1/providers', (req, res) => {
  res.json({ success: true, providers: registry.getProviders() });
});

router.get('/v1/providers/:provider', (req, res) => {
  const p = registry.getProvider(req.params.provider);
  if (!p) return sendError(res, 404, ERROR_CODES.PROVIDER_UNAVAILABLE, 'Provider not found');
  const credentials = registry.getCredentials(p.id).map((c) => ({
    id: c.id, enabled: c.enabled, priority: c.priority, weight: c.weight, secret_env: c.secret_env
    // secret values are never exposed
  }));
  res.json({ success: true, provider: p, credentials });
});

router.get('/v1/models', (req, res) => {
  res.json({ success: true, models: registry.getModels() });
});

router.get('/v1/models/:model', (req, res) => {
  const m = registry.getModels().find((x) => x.model === req.params.model);
  if (!m) return sendError(res, 404, ERROR_CODES.MODEL_NOT_FOUND, 'Model not found');
  res.json({ success: true, model: m });
});

router.get('/v1/workers', (req, res) => {
  res.json({ success: true, workers: registry.getWorkers() });
});

router.get('/v1/workers/:worker', (req, res) => {
  const w = registry.getWorker(req.params.worker);
  if (!w) return sendError(res, 404, ERROR_CODES.WORKER_UNAVAILABLE, 'Worker not found');
  res.json({ success: true, worker: w });
});

router.get('/v1/capabilities', (req, res) => {
  res.json({ success: true, capabilities: registry.getCapabilities() });
});

// ---------------------------------------------------------------------
// POST /v1/classify
// ---------------------------------------------------------------------

router.post('/v1/classify', async (req, res) => {
  metrics.classificationRequestsTotal.inc();
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Field "message" is required');
  }
  const request_id = uuidv4();
  const trace_id = req.body.trace_id || uuidv4();

  const result = await classifier.classify({ message, request_id, trace_id });

  if (result.failed) {
    metrics.normalizedErrorsTotal.inc({ code: ERROR_CODES.CLASSIFICATION_FAILED });
    return sendError(res, 422, ERROR_CODES.CLASSIFICATION_FAILED, 'Could not parse structured classification output', {
      worker: result.worker, provider: result.provider, model: result.model, request_id, trace_id
    });
  }

  res.json({
    success: true,
    intent: result.intent,
    task: result.task,
    capabilities: result.capabilities,
    confidence: result.confidence,
    worker: result.worker,
    provider: result.provider,
    model: result.model,
    degraded: !!result.degraded,
    request_id,
    trace_id
  });
});

// ---------------------------------------------------------------------
// POST /v1/resolve
// ---------------------------------------------------------------------

router.post('/v1/resolve', (req, res) => {
  metrics.resolutionRequestsTotal.inc();
  const { capability } = req.body || {};
  if (!capability || typeof capability !== 'string') {
    return sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Field "capability" is required');
  }
  const resolved = resolver.resolveCapability(capability);
  if (!resolved.ok) {
    metrics.normalizedErrorsTotal.inc({ code: resolved.code });
    return sendError(res, 404, resolved.code, resolved.message);
  }
  res.json({
    success: true,
    worker: resolved.worker,
    provider: resolved.provider,
    model: resolved.model,
    priority: resolved.priority,
    weight: resolved.weight
  });
});

// ---------------------------------------------------------------------
// POST /v1/execute (internal-oriented)
// ---------------------------------------------------------------------

router.post('/v1/execute', async (req, res) => {
  metrics.executionRequestsTotal.inc();
  const { worker, provider, model, messages, capabilities, session_id, request_id, trace_id } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Field "messages" (non-empty array) is required');
  }

  let targetProvider = provider;
  let targetModel = model;
  let targetWorker = worker;

  if ((!targetProvider || !targetModel) && Array.isArray(capabilities) && capabilities.length) {
    const resolved = resolver.resolveCapability(capabilities[0]);
    if (!resolved.ok) {
      metrics.normalizedErrorsTotal.inc({ code: resolved.code });
      return sendError(res, 404, resolved.code, resolved.message);
    }
    targetProvider = targetProvider || resolved.provider;
    targetModel = targetModel || resolved.model;
    targetWorker = targetWorker || resolved.worker;
  }

  if (!targetProvider || !targetModel) {
    return sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Unable to resolve provider/model; supply provider+model or capabilities');
  }

  const modelCfg = registry.getModel(targetProvider, targetModel);
  if (!modelCfg || !registry.isModelSelectable(modelCfg)) {
    metrics.normalizedErrorsTotal.inc({ code: ERROR_CODES.MODEL_NOT_FOUND });
    return sendError(res, 404, ERROR_CODES.MODEL_NOT_FOUND, 'Configured model is unavailable', { provider: targetProvider, model: targetModel });
  }

  const rid = request_id || uuidv4();
  const tid = trace_id || uuidv4();

  if (targetWorker) metrics.workerRequestsTotal.inc({ worker: targetWorker });

  const result = await day3Client.execute({
    provider: targetProvider,
    model: targetModel,
    messages,
    request_id: rid,
    trace_id: tid
  });

  await db.logOrchestrationEvent({
    request_id: rid, trace_id: tid, session_id, worker: targetWorker,
    provider: targetProvider, model: targetModel, status: result.ok ? 'success' : 'error',
    error_code: result.ok ? null : result.code
  });

  if (!result.ok) {
    if (targetWorker) metrics.workerFailuresTotal.inc({ worker: targetWorker });
    metrics.providerErrorsTotal.inc({ provider: targetProvider });
    metrics.modelErrorsTotal.inc({ provider: targetProvider, model: targetModel });
    metrics.normalizedErrorsTotal.inc({ code: result.code });
    return sendError(res, 502, result.code, result.message, {
      provider: targetProvider, model: targetModel, request_id: rid, trace_id: tid
    });
  }

  res.json({
    success: true,
    worker: targetWorker || null,
    provider: targetProvider,
    model: targetModel,
    response: extractText(result.data),
    raw: result.data,
    request_id: rid,
    trace_id: tid
  });
});

// ---------------------------------------------------------------------
// POST /v1/chat - primary human-facing endpoint
// ---------------------------------------------------------------------

router.post('/v1/chat', async (req, res) => {
  metrics.chatRequestsTotal.inc();

  const { message, session_id, user_id, agent_name, metadata, depth: depthIn } = req.body || {};

  if (!message || typeof message !== 'string') {
    return sendError(res, 400, ERROR_CODES.INVALID_REQUEST, 'Field "message" is required');
  }

  const request_id = uuidv4();
  const trace_id = req.body.trace_id || uuidv4();
  const depth = typeof depthIn === 'number' ? depthIn : 0;
  const max_depth = config.maxOrchestrationDepth;

  if (depth >= max_depth) {
    metrics.orchestrationDepthExceededTotal.inc();
    metrics.normalizedErrorsTotal.inc({ code: ERROR_CODES.MAX_ORCHESTRATION_DEPTH });
    return sendError(res, 429, ERROR_CODES.MAX_ORCHESTRATION_DEPTH, 'Maximum orchestration depth exceeded', {
      request_id, trace_id, depth, max_depth
    });
  }

  // 4. Resolve session (Day 4)
  const sessionResult = await day4Client.ensureSession(session_id, user_id);
  const resolvedSessionId = sessionResult.session_id || session_id || null;

  // 5. Retrieve context from Day 4
  const contextResult = await day4Client.getContext(resolvedSessionId);

  // 6-9. Classify request -> intent / task / capabilities
  const classification = await classifier.classify({ message, request_id, trace_id });

  if (classification.failed) {
    metrics.normalizedErrorsTotal.inc({ code: ERROR_CODES.CLASSIFICATION_FAILED });
    await db.logOrchestrationEvent({
      request_id, trace_id, session_id: resolvedSessionId, status: 'error', error_code: ERROR_CODES.CLASSIFICATION_FAILED
    });
    return sendError(res, 422, ERROR_CODES.CLASSIFICATION_FAILED, 'Could not classify request', {
      request_id, trace_id, session_id: resolvedSessionId, depth, max_depth
    });
  }

  const capability = (classification.capabilities && classification.capabilities[0]) || classification.intent || 'chat';

  // 10-12. Select worker / model / provider
  const resolved = resolver.resolveCapability(capability);
  if (!resolved.ok) {
    metrics.normalizedErrorsTotal.inc({ code: resolved.code });
    await db.logOrchestrationEvent({
      request_id, trace_id, session_id: resolvedSessionId, intent: classification.intent, task: classification.task,
      status: 'error', error_code: resolved.code
    });
    return sendError(res, 404, resolved.code, resolved.message, {
      request_id, trace_id, session_id: resolvedSessionId, intent: classification.intent, task: classification.task, depth, max_depth
    });
  }

  // Build message history for the worker: prior context + new user turn
  const history = (contextResult.messages || []).map((m) => ({ role: m.role, content: m.content }));
  const chatMessages = [...history, { role: 'user', content: message }];

  metrics.workerRequestsTotal.inc({ worker: resolved.worker });

  // 13. Execute through Day 3
  const execResult = await day3Client.execute({
    provider: resolved.provider,
    model: resolved.model,
    messages: chatMessages,
    temperature: resolved.temperature,
    max_tokens: resolved.max_tokens,
    request_id,
    trace_id
  });

  if (!execResult.ok) {
    metrics.workerFailuresTotal.inc({ worker: resolved.worker });
    metrics.providerErrorsTotal.inc({ provider: resolved.provider });
    metrics.modelErrorsTotal.inc({ provider: resolved.provider, model: resolved.model });
    metrics.normalizedErrorsTotal.inc({ code: execResult.code });
    await db.logOrchestrationEvent({
      request_id, trace_id, session_id: resolvedSessionId, worker: resolved.worker, provider: resolved.provider,
      model: resolved.model, intent: classification.intent, task: classification.task, status: 'error', error_code: execResult.code
    });
    return sendError(res, 502, execResult.code, execResult.message, {
      request_id, trace_id, session_id: resolvedSessionId, worker: resolved.worker,
      provider: resolved.provider, model: resolved.model, intent: classification.intent, task: classification.task, depth, max_depth
    });
  }

  // 14. Normalize provider response
  const responseText = extractText(execResult.data);

  // 15. Validate response
  const validation = validator.validateResponse({
    responseText, provider: resolved.provider, model: resolved.model, request_id
  });

  if (!validation.valid) {
    metrics.normalizedErrorsTotal.inc({ code: ERROR_CODES.RESPONSE_VALIDATION_FAILED });
    await db.logOrchestrationEvent({
      request_id, trace_id, session_id: resolvedSessionId, worker: resolved.worker, provider: resolved.provider,
      model: resolved.model, intent: classification.intent, task: classification.task,
      status: 'error', error_code: ERROR_CODES.RESPONSE_VALIDATION_FAILED
    });
    return sendError(res, 502, ERROR_CODES.RESPONSE_VALIDATION_FAILED, validation.reason, {
      request_id, trace_id, session_id: resolvedSessionId, worker: resolved.worker,
      provider: resolved.provider, model: resolved.model, depth, max_depth
    });
  }

  // 16. Persist relevant conversation information through Day 4
  await day4Client.persistTurn(resolvedSessionId, { role: 'user', content: message, meta: { agent_name, metadata, request_id, trace_id } });
  await day4Client.persistTurn(resolvedSessionId, { role: 'assistant', content: responseText, meta: { worker: resolved.worker, provider: resolved.provider, model: resolved.model, request_id, trace_id } });

  await db.logOrchestrationEvent({
    request_id, trace_id, session_id: resolvedSessionId, worker: resolved.worker, provider: resolved.provider,
    model: resolved.model, intent: classification.intent, task: classification.task, status: 'success'
  });

  // 17. Return final response
  res.json({
    success: true,
    session_id: resolvedSessionId,
    request_id,
    trace_id,
    intent: classification.intent,
    task: classification.task,
    worker: resolved.worker,
    provider: resolved.provider,
    model: resolved.model,
    response: responseText,
    depth,
    max_depth,
    context_degraded: !!contextResult.degraded,
    classification_degraded: !!classification.degraded
  });
});

module.exports = router;
