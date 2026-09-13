'use strict';

const axios = require('axios');
const config = require('./config');
const { ERROR_CODES } = require('./errors');

const client = axios.create({ baseURL: config.day3Url, timeout: 30000 });

const N8N_COMFY_WEBHOOK_URL = process.env.N8N_COMFY_WEBHOOK_URL || null;

// Best-effort, non-blocking notify. Never throws, never awaited by callers.
// n8n's Function node expects: { message, session_id, external_ref, title, detected_niche, variant_count }
function notifyComfyWebhook({ request_id, trace_id, message, detected_niche }) {
  if (!N8N_COMFY_WEBHOOK_URL) {
    console.log(`[n8n_comfy_webhook] skipped (no N8N_COMFY_WEBHOOK_URL configured) request_id=${request_id}`);
    return;
  }
  if (!message || !String(message).trim()) {
    console.log(`[n8n_comfy_webhook] skipped (empty message) request_id=${request_id}`);
    return;
  }

  const payload = {
    message: String(message).trim(),
    session_id: request_id || trace_id,
    external_ref: trace_id || null,
    title: String(message).trim().slice(0, 60),
    detected_niche: detected_niche || null,
    variant_count: null,
  };

  console.log(`[n8n_comfy_webhook] sending request_id=${request_id} title="${payload.title}"`);

  Promise.resolve()
    .then(() => axios.post(N8N_COMFY_WEBHOOK_URL, payload, { timeout: 10000 }))
    .then((res) => {
      console.log(`[n8n_comfy_webhook] sent OK request_id=${request_id} status=${res.status}`);
    })
    .catch((err) => {
      const status = err.response ? err.response.status : 'no_response';
      console.warn(`[n8n_comfy_webhook] failed request_id=${request_id} status=${status} error=${err.message}`);
    });
}

async function isAvailable() {
  try {
    await client.get('/health');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Sends a normalized execution request to Day 3, which performs the
 * actual provider call. Day 5 never talks to Groq/Gemini directly.
 */
async function execute({ provider, model, messages, temperature, max_tokens, request_id, trace_id }) {
  try {
    const res = await client.post('/v1/execute', {
      provider,
      model,
      messages,
      temperature,
      max_tokens,
      request_id,
      trace_id
    });

    // Best-effort side call — fire-and-forget, never blocks or affects the caller's response.
    const responseText = extractResponseText(res.data);
    notifyComfyWebhook({
      request_id,
      trace_id,
      message: responseText,
      detected_niche: provider || null,
    });

    return { ok: true, data: res.data };
  } catch (err) {
    if (!err.response) {
      const code = err.code === 'ECONNABORTED' ? ERROR_CODES.TIMEOUT : ERROR_CODES.PROVIDER_UNAVAILABLE;
      return { ok: false, code, message: err.message };
    }
    const status = err.response.status;
    const upstream = err.response.data && err.response.data.error;
    if (status === 401 || status === 403) {
      return { ok: false, code: ERROR_CODES.AUTHENTICATION_FAILED, message: 'Provider authentication failed' };
    }
    if (status === 404) {
      return { ok: false, code: ERROR_CODES.MODEL_NOT_FOUND, message: 'Configured model is unavailable' };
    }
    if (status === 429) {
      return { ok: false, code: ERROR_CODES.RATE_LIMITED, message: 'Provider rate limit exceeded' };
    }
    if (status === 408 || status === 504) {
      return { ok: false, code: ERROR_CODES.TIMEOUT, message: 'Provider request timed out' };
    }
    if (status >= 500) {
      return { ok: false, code: ERROR_CODES.UPSTREAM_ERROR, message: 'Upstream provider error' };
    }
    return {
      ok: false,
      code: (upstream && upstream.code) || ERROR_CODES.INVALID_REQUEST,
      message: (upstream && upstream.message) || 'Invalid execution request'
    };
  }
}

function extractResponseText(data) {
  if (!data) return '';
  if (typeof data.response === 'string') return data.response;
  if (data.response && typeof data.response === 'object') {
    return data.response.text || data.response.content || '';
  }
  if (typeof data.message === 'string') return data.message;
  return '';
}

module.exports = { isAvailable, execute };