'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const originalCreate = axios.create;
let calls;
let clientStub;

function resetClient() {
  calls = [];
  clientStub = {
    get: async (url) => {
      calls.push({ method: 'get', url });
      if (url === '/health') return { status: 200, data: { status: 'ok' } };
      if (url === '/v1/session/valid-id') {
        return { status: 200, data: { success: true, session: { session_id: 'valid-id' } } };
      }
      if (url === '/v1/session/missing-id') {
        const error = new Error('not found');
        error.response = { status: 404 };
        throw error;
      }
      if (url === '/v1/session/session%2Fwith%20space/messages') {
        return { status: 200, data: { success: true, messages: [{ role: 'user', content: 'hello', metadata: {} }] } };
      }
      return { status: 200, data: { success: true, messages: [] } };
    },
    post: async (url, body) => {
      calls.push({ method: 'post', url, body });
      return { status: 201, data: { success: true, session_id: 'created-id', message_id: 'message-id' } };
    }
  };
  axios.create = () => clientStub;
  delete require.cache[require.resolve('../src/day4Client')];
  return require('../src/day4Client');
}

test.after(() => { axios.create = originalCreate; });

test('creates a Day 4 session with a valid fallback user id', async () => {
  const api = resetClient();
  const result = await api.ensureSession(null, null, {});
  assert.deepEqual(result, { session_id: 'created-id', created: true, degraded: false });
  assert.equal(calls[0].url, '/v1/session');
  assert.equal(calls[0].body.user_id, 'anonymous');
});

test('validates a supplied session using the Day 4 singular endpoint', async () => {
  const api = resetClient();
  const result = await api.ensureSession('valid-id', 'user-1');
  assert.equal(result.session_id, 'valid-id');
  assert.equal(result.created, false);
  assert.equal(calls[0].url, '/v1/session/valid-id');
});

test('flags a missing supplied session rather than silently accepting it', async () => {
  const api = resetClient();
  const result = await api.ensureSession('missing-id', 'user-1');
  assert.equal(result.invalid_session, true);
  assert.equal(result.session_id, null);
});

test('retrieves chronological message history from the supported endpoint', async () => {
  const api = resetClient();
  const result = await api.getContext('session/with space');
  assert.equal(calls[0].url, '/v1/session/session%2Fwith%20space/messages');
  assert.equal(result.degraded, false);
  assert.deepEqual(result.messages.map(({ role, content }) => ({ role, content })), [{ role: 'user', content: 'hello' }]);
});

test('persists message metadata under the Day 4 metadata field', async () => {
  const api = resetClient();
  const result = await api.persistTurn('valid-id', { role: 'assistant', content: 'hello', metadata: { trace_id: 'trace-1' } });
  assert.equal(result.persisted, true);
  assert.equal(calls[0].url, '/v1/session/valid-id/messages');
  assert.deepEqual(calls[0].body.metadata, { trace_id: 'trace-1' });
  assert.equal(Object.hasOwn(calls[0].body, 'meta'), false);
});
