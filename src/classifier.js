'use strict';

const resolver = require('./resolver');
const day3Client = require('./day3Client');
const metrics = require('./metrics');
const { ERROR_CODES } = require('./errors');
const db = require('./db');

const VALID_INTENTS = new Set([
  'chat', 'vision', 'code', 'reasoning', 'summarization',
  'extraction', 'translation', 'classification', 'unknown'
]);

// --- .env-configurable defaults for hard-failure fallback ---
const RAW_DEFAULT_INTENT = (process.env.CLASSIFICATION_DEFAULT_INTENT || 'chat').toLowerCase().trim();
const DEFAULT_INTENT = VALID_INTENTS.has(RAW_DEFAULT_INTENT) && RAW_DEFAULT_INTENT !== 'unknown'
  ? RAW_DEFAULT_INTENT
  : 'chat';

const DEFAULT_CAPABILITIES = (process.env.CLASSIFICATION_DEFAULT_CAPABILITIES || DEFAULT_INTENT)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classification engine for an AI gateway.
Classify the user's message into exactly one JSON object with this shape:
{"intent":"chat|vision|code|reasoning|summarization|extraction|translation|classification|unknown","task":"short_snake_case_task_name","capabilities":["capability1","capability2"],"confidence":0.0-1.0,"reason":"short reason"}
Rules:
- "capabilities" is REQUIRED and MUST be a non-empty JSON array of strings. If unsure, repeat the intent name, e.g. ["chat"].
- Never omit "capabilities", and never return null, an empty array, or a string for it.
Respond with ONLY the JSON object. No prose, no markdown fences.`;

/**
 * Safely parse JSON or markdown-fenced JSON text blocks.
 */
function tryParseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (err2) {
        return null;
      }
    }
    return null;
  }
}

function extractText(data) {
  if (typeof data === 'string') return data;
  return data?.response || data?.choices?.[0]?.message?.content || data?.content || '';
}

function heuristicFallback(message) {
  const text = (message || '').toLowerCase();
  if (/image|picture|photo|screenshot|identify what/i.test(text)) {
    return { intent: 'vision', task: 'image_identification', capabilities: ['vision', 'image_understanding'], confidence: 0.5, reason: 'heuristic fallback' };
  }
  if (/```|function |script|code|bash|python|javascript/i.test(text)) {
    return { intent: 'code', task: 'code_generation', capabilities: ['code', 'reasoning'], confidence: 0.5, reason: 'heuristic fallback' };
  }
  if (/summarize|summary/i.test(text)) {
    return { intent: 'summarization', task: 'summarize_text', capabilities: ['summarization'], confidence: 0.5, reason: 'heuristic fallback' };
  }
  if (/translate/i.test(text)) {
    return { intent: 'translation', task: 'translate_text', capabilities: ['translation'], confidence: 0.5, reason: 'heuristic fallback' };
  }
  // Ultimate fallback now driven by .env instead of a hardcoded 'chat'
  return { intent: DEFAULT_INTENT, task: 'conversation', capabilities: DEFAULT_CAPABILITIES, confidence: 0.4, reason: 'heuristic fallback (default)' };
}

async function classify({ message, request_id, trace_id }) {
  metrics.classificationRequestsTotal.inc();

  const resolved = resolver.resolveCapability('classification');

  // Branch 1: No classification worker available
  if (!resolved || !resolved.ok) {
    metrics.classificationFallbacksTotal.inc({ reason: 'no_worker' });
    metrics.capabilityFallbackTotal.inc({ requested_capability: 'classification', fallback_capability: 'chat' });

    const fallback = heuristicFallback(message);
    metrics.classificationEventsTotal.inc({ intent: fallback.intent, status: 'degraded', resolution: 'heuristic' });

    await db.logOrchestrationEvent({
      request_id,
      trace_id,
      status: 'classification_degraded',
      error_code: resolved?.code || 'NO_WORKER',
      detail: { reason: 'no_classification_worker', message: resolved?.message }
    });

    return { ...fallback, worker: null, provider: null, model: null, degraded: true };
  }

  metrics.workerRequestsTotal.inc({ worker: resolved.worker });

  // Branch 2: Upstream LLM call fails
  const result = await day3Client.execute({
    provider: resolved.provider,
    model: resolved.model,
    messages: [
      { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
      { role: 'user', content: message }
    ],
    temperature: resolved.temperature,
    max_tokens: resolved.max_tokens,
    request_id,
    trace_id
  });

  if (!result.ok) {
    metrics.workerFailuresTotal.inc({ worker: resolved.worker });
    metrics.classificationFallbacksTotal.inc({ reason: 'upstream_error' });
    metrics.capabilityFallbackTotal.inc({ requested_capability: 'classification', fallback_capability: 'chat' });

    const fallback = heuristicFallback(message);
    metrics.classificationEventsTotal.inc({ intent: fallback.intent, status: 'degraded', resolution: 'heuristic' });

    await db.logOrchestrationEvent({
      request_id,
      trace_id,
      worker: resolved.worker,
      provider: resolved.provider,
      model: resolved.model,
      status: 'classification_degraded',
      error_code: result.code,
      detail: { reason: 'day3_execute_failed' }
    });

    return { ...fallback, worker: resolved.worker, provider: resolved.provider, model: resolved.model, degraded: true, upstream_error: result.code };
  }

  const text = extractText(result.data);

  // --- try/catch around parsing + validation ---
  let parsed = null;
  try {
    parsed = tryParseJson(text);
  } catch (err) {
    parsed = null;
  }

  const hasValidIntent = !!parsed && VALID_INTENTS.has(parsed.intent) && parsed.intent !== 'unknown';
  const hasCapabilities = Array.isArray(parsed?.capabilities) && parsed.capabilities.length > 0;

  // Branch 3a (soft failure): intent is valid, only "capabilities" is missing/malformed.
  // This is an ambiguity in the model's output, not a real misclassification —
  // repair it and return as a successful result instead of dropping to heuristics.
  if (hasValidIntent && !hasCapabilities) {
    metrics.classificationFallbacksTotal.inc({ reason: 'capabilities_missing' });
    metrics.classificationEventsTotal.inc({ intent: parsed.intent, status: 'success', resolution: 'model_repaired' });

    await db.logOrchestrationEvent({
      request_id,
      trace_id,
      worker: resolved.worker,
      provider: resolved.provider,
      model: resolved.model,
      status: 'classification_capabilities_missing',
      error_code: 'CLASSIFICATION_CAPABILITIES_MISSING',
      detail: { raw_text: text }
    });

    return {
      intent: parsed.intent,
      task: parsed.task || 'unknown_task',
      capabilities: [parsed.intent],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reason: parsed.reason || 'capabilities backfilled from intent',
      worker: resolved.worker,
      provider: resolved.provider,
      model: resolved.model,
      failed: false,
      repaired: true
    };
  }

  // Branch 3b (hard failure): unparseable JSON or a genuinely invalid/unknown intent
  if (!hasValidIntent) {
    const fallbackReason = !parsed ? 'parse_failure' : 'unknown_intent';
    metrics.classificationFallbacksTotal.inc({ reason: fallbackReason });
    metrics.capabilityFallbackTotal.inc({ requested_capability: 'classification', fallback_capability: 'chat' });

    const fallback = heuristicFallback(message);
    metrics.classificationEventsTotal.inc({ intent: fallback.intent, status: 'degraded', resolution: 'heuristic' });

    await db.logOrchestrationEvent({
      request_id,
      trace_id,
      worker: resolved.worker,
      provider: resolved.provider,
      model: resolved.model,
      status: 'classification_degraded',
      error_code: 'CLASSIFICATION_INVALID_RESPONSE',
      detail: { raw_text: text }
    });

    return { ...fallback, worker: resolved.worker, provider: resolved.provider, model: resolved.model, degraded: true };
  }

  // Branch 4: Successful classification
  metrics.classificationEventsTotal.inc({ intent: parsed.intent, status: 'success', resolution: 'model' });

  return {
    intent: parsed.intent,
    task: parsed.task || 'unknown_task',
    capabilities: parsed.capabilities.length ? parsed.capabilities : [parsed.intent],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    reason: parsed.reason || '',
    worker: resolved.worker,
    provider: resolved.provider,
    model: resolved.model,
    failed: false
  };
}

module.exports = { classify, extractText };