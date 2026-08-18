'use strict';

const axios = require('axios');
const config = require('./config');

const client = axios.create({ baseURL: config.day4Url, timeout: 5000 });

async function isAvailable() {
  try {
    await client.get('/health');
    return true;
  } catch (err) {
    return false;
  }
}

// Creates a session in Day 4 if one was not supplied.
async function ensureSession(sessionId, userId) {
  if (sessionId) return { session_id: sessionId, created: false };
  try {
    const res = await client.post('/v1/sessions', { user_id: userId || null });
    return { session_id: res.data.session_id || res.data.id, created: true };
  } catch (err) {
    // Day 4 unavailable - degrade gracefully with a locally generated session id.
    return { session_id: null, created: false, degraded: true };
  }
}

async function getContext(sessionId) {
  if (!sessionId) return { messages: [], degraded: true };
  try {
    const res = await client.get(`/v1/sessions/${sessionId}/context`);
    return { messages: res.data.messages || res.data.context || [], degraded: false };
  } catch (err) {
    return { messages: [], degraded: true };
  }
}

async function persistTurn(sessionId, { role, content, meta } = {}) {
  if (!sessionId) return { persisted: false, degraded: true };
  try {
    await client.post(`/v1/sessions/${sessionId}/messages`, { role, content, meta });
    return { persisted: true };
  } catch (err) {
    return { persisted: false, degraded: true };
  }
}

module.exports = { isAvailable, ensureSession, getContext, persistTurn };
