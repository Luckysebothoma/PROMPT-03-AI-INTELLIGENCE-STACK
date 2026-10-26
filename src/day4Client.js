'use strict';

// Day 5 -> Day 4 client. Targets Day 4's canonical (plural) API:
//   POST /v1/sessions                      -> 201 { session_id }
//   GET  /v1/sessions/:id                  -> 200 | 404 unknown | 400 malformed UUID
//   GET  /v1/sessions/:id/context          -> { messages[], message_count, truncated, ... }
//   POST /v1/sessions/:id/messages         -> { role, content, metadata }
//   GET  /health
//
// Design rules:
//  - Never throws. Every function returns a result object with `degraded` set on failure.
//  - Every degradation is logged (console.warn) so it can't hide silently.
//  - A client-supplied session id is VERIFIED against Day 4. If Day 4 does not know it
//    (404) or it is not a UUID (400), a new Day 4 session is created and the result is
//    flagged `replaced: true` so the caller can tell the client to adopt the new id.

const axios = require('axios');
const config = require('./config');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = parseInt(process.env.DAY4_TIMEOUT_MS || '5000', 10);
const CONTEXT_MAX = parseInt(process.env.CONTEXT_MAX_MESSAGES || '0', 10) || null;

const client = axios.create({
  baseURL: config.day4Url,
  timeout: TIMEOUT_MS,
  validateStatus: () => true // we handle status codes explicitly
});

function warn(op, detail) {
  console.warn(`[day4] ${op} degraded: ${detail} (DAY4_URL=${config.day4Url})`);
}

function netReason(err) {
  return (err && (err.code || err.message)) || 'unknown_error';
}

async function createSession(userId, agentName, metadata) {
  const res = await client.post('/v1/sessions', {
    user_id: userId || null,
    agent_name: agentName || undefined,
    metadata: metadata && typeof metadata === 'object' ? metadata : undefined
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create_session_http_${res.status}`);
  }
  const id = res.data && (res.data.session_id || res.data.id);
  if (!id) throw new Error('create_session_no_id');
  return id;
}

/**
 * Resolve a usable Day 4 session id.
 * @returns {{session_id: string|null, created: boolean, replaced: boolean,
 *            previous_session_id: string|null, degraded: boolean, reason?: string}}
 */
async function ensureSession(sessionId, userId, agentName, metadata) {
  const supplied = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
  try {
    if (supplied && UUID_RE.test(supplied)) {
      const res = await client.get(`/v1/sessions/${supplied}`);
      if (res.status === 200) {
        return { session_id: supplied, created: false, replaced: false, previous_session_id: null, degraded: false };
      }
      if (res.status !== 404 && res.status !== 400) {
        throw new Error(`verify_session_http_${res.status}`);
      }
      // 404/400: Day 4 does not know this id -> fall through and create one
    }
    const newId = await createSession(userId, agentName, metadata);
    return {
      session_id: newId,
      created: true,
      replaced: !!supplied,
      previous_session_id: supplied,
      degraded: false
    };
  } catch (err) {
    const reason = netReason(err);
    warn('ensureSession', reason);
    return { session_id: null, created: false, replaced: false, previous_session_id: supplied, degraded: true, reason };
  }
}

/** @returns {{messages: Array, message_count: number, truncated: boolean, degraded: boolean, reason?: string}} */
async function getContext(sessionId, maxMessages) {
  if (!sessionId) return { messages: [], message_count: 0, truncated: false, degraded: true, reason: 'no_session' };
  const limit = maxMessages || CONTEXT_MAX;
  try {
    const res = await client.get(`/v1/sessions/${sessionId}/context`, { params: limit ? { max_messages: limit } : undefined });
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) {
      throw new Error(`context_http_${res.status}`);
    }
    return {
      messages: res.data.messages,
      message_count: res.data.message_count || res.data.messages.length,
      truncated: !!res.data.truncated,
      degraded: false
    };
  } catch (err) {
    const reason = netReason(err);
    warn('getContext', reason);
    return { messages: [], message_count: 0, truncated: false, degraded: true, reason };
  }
}

/** @returns {{persisted: boolean, degraded: boolean, reason?: string}} */
async function persistTurn(sessionId, { role, content, meta } = {}) {
  if (!sessionId) return { persisted: false, degraded: true, reason: 'no_session' };
  if (typeof content !== 'string' || !content.trim()) {
    return { persisted: false, degraded: false, reason: 'empty_content' };
  }
  try {
    const res = await client.post(`/v1/sessions/${sessionId}/messages`, {
      role,
      content,
      metadata: meta && typeof meta === 'object' ? JSON.parse(JSON.stringify(meta)) : {}
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`persist_http_${res.status}`);
    return { persisted: true, degraded: false };
  } catch (err) {
    const reason = netReason(err);
    warn('persistTurn', reason);
    return { persisted: false, degraded: true, reason };
  }
}

async function isAvailable() {
  try {
    const res = await client.get('/health', { timeout: 2000 });
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

module.exports = { ensureSession, getContext, persistTurn, isAvailable, UUID_RE };