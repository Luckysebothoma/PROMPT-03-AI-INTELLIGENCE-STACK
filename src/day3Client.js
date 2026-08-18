'use strict';

const axios = require('axios');
const config = require('./config');
const { ERROR_CODES } = require('./errors');

const client = axios.create({ baseURL: config.day3Url, timeout: 30000 });

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

module.exports = { isAvailable, execute };
