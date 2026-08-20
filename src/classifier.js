'use strict';

const resolver = require('./resolver');
const day3Client = require('./day3Client');
const metrics = require('./metrics');
const { ERROR_CODES } = require('./errors');
const db = require('./db');              // <-- new

const VALID_INTENTS = new Set([
  'chat', 'vision', 'code', 'reasoning', 'summarization',
  'extraction', 'translation', 'classification', 'unknown'
]);

const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classification engine for an AI gateway.
Classify the user's message into exactly one JSON object with this shape:
{"intent":"chat|vision|code|reasoning|summarization|extraction|translation|classification|unknown","task":"short_snake_case_task_name","capabilities":["capability1","capability2"],"confidence":0.0-1.0,"reason":"short reason"}
Respond with ONLY the JSON object. No prose, no markdown fences.`;

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
  return { intent: 'chat', task: 'conversation', capabilities: ['chat'], confidence: 0.4, reason: 'heuristic fallback' };
}

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

async function classify({ message, request_id, trace_id }) {
  const resolved = resolver.resolveCapability('classification');
  if (!resolved.ok) {
    // No classifier worker configured/available - degrade to heuristic rather than fail hard.
    await db.logOrchestrationEvent({
      request_id, trace_id, status: 'classification_degraded',
      error_code: resolved.code,
      detail: { reason: 'no_classification_worker', message: resolved.message }
    });                                    // <-- new
    return { ...heuristicFallback(message), worker: null, provider: null, model: null, degraded: true };
  }

  metrics.workerRequestsTotal.inc({ worker: resolved.worker });

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
    await db.logOrchestrationEvent({
      request_id, trace_id, worker: resolved.worker, provider: resolved.provider, model: resolved.model,
      status: 'classification_degraded', error_code: result.code,
      detail: { reason: 'day3_execute_failed' }
    });                                    // <-- new
    return {
      ...heuristicFallback(message),
      worker: resolved.worker, provider: resolved.provider, model: resolved.model,
      degraded: true, upstream_error: result.code
    };
  }

  const text = extractText(result.data);
  const parsed = tryParseJson(text);

  if (!parsed || !VALID_INTENTS.has(parsed.intent) || !Array.isArray(parsed.capabilities)) {
    return {
      intent: null,
      task: null,
      capabilities: [],
      confidence: 0,
      reason: 'CLASSIFICATION_FAILED',
      worker: resolved.worker,
      provider: resolved.provider,
      model: resolved.model,
      failed: true,
      code: ERROR_CODES.CLASSIFICATION_FAILED
    };
  }

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

function extractText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data.content) return data.content;
  if (data.response) return data.response;
  if (data.choices && data.choices[0]) {
    const c = data.choices[0];
    return c.message ? c.message.content : c.text || '';
  }
  return JSON.stringify(data);
}

module.exports = { classify, extractText, VALID_INTENTS };
