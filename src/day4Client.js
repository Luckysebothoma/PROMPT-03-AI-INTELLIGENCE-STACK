'use strict';

const axios = require('axios');
const config = require('./config');

const client = axios.create({
  baseURL: config.day4Url,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' }
});

async function isAvailable() {
  try {
    const res = await client.get('/health');
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

// Creates a real Day 4 session when one was not supplied. If a supplied ID
// is invalid, report it instead of silently pretending that persistence works.
async function ensureSession(sessionId, userId, metadata = {}) {
  if (sessionId) {
    try {
      const res = await client.get('/v1/session/' + encodeURIComponent(sessionId));
      if (res.status === 200 && res.data && res.data.success && res.data.session) {
        return { session_id: sessionId, created: false, degraded: false };
      }
      return { session_id: null, created: false, degraded: true, invalid_session: true };
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return { session_id: null, created: false, degraded: true, invalid_session: true };
      }
      // Day 4 may be temporarily offline; preserve the supplied ID for this
      // request but expose degradation to the caller.
      return { session_id: sessionId, created: false, degraded: true };
    }
  }

  const resolvedUserId = userId || metadata.user_id || 'anonymous';
  try {
    const res = await client.post('/v1/session', {
      user_id: resolvedUserId,
      agent_name: metadata.agent_name || 'general-assistant',
      metadata
    });
    const id = res.data && res.data.session_id;
    if (res.status >= 200 && res.status < 300 && res.data.success && id) {
      return { session_id: id, created: true, degraded: false };
    }
    return { session_id: null, created: false, degraded: true };
  } catch (err) {
    return { session_id: null, created: false, degraded: true };
  }
}

// Day 4's message-list API is the supported history contract. It returns
// chronological message objects, including role/content/metadata.
async function getContext(sessionId) {
  if (!sessionId) return { messages: [], degraded: true };
  try {
    const res = await client.get('/v1/session/' + encodeURIComponent(sessionId) + '/messages');
    if (!res.data || res.data.success !== true || !Array.isArray(res.data.messages)) {
      return { messages: [], degraded: true };
    }
    return {
      messages: res.data.messages
        .filter((message) => message && typeof message.role === 'string' && typeof message.content === 'string')
        .map(({ role, content, metadata, created_at }) => ({ role, content, metadata, created_at })),
      degraded: false
    };
  } catch (err) {
    return { messages: [], degraded: true };
  }
}

async function persistTurn(sessionId, { role, content, metadata, meta } = {}) {
  if (!sessionId) return { persisted: false, degraded: true };
  try {
    const res = await client.post(
      '/v1/session/' + encodeURIComponent(sessionId) + '/messages',
      { role, content, metadata: metadata || meta || {} }
    );
    if (res.status >= 200 && res.status < 300 && res.data && res.data.success === true) {
      return { persisted: true, degraded: false, message_id: res.data.message_id };
    }
    return { persisted: false, degraded: true };
  } catch (err) {
    return { persisted: false, degraded: true };
  }
}

module.exports = { isAvailable, ensureSession, getContext, persistTurn };
