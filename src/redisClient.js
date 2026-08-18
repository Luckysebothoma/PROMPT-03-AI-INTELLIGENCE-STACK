'use strict';

const Redis = require('ioredis');
const config = require('./config');

const client = new Redis({
  host: config.redis.host,
  port: config.redis.port,
//  password: config.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null // Redis is a cache, not authoritative - never blocks or spams retries
});

let connected = false;

// ioredis emits 'error' on every failed background reconnect attempt; without a
// listener this would crash the process. Swallow quietly - Redis is optional.
client.on('error', () => {
  connected = false;
});

async function connect() {
  try {
    await client.connect();
    connected = true;
  } catch (err) {
    connected = false;
    // eslint-disable-next-line no-console
    console.error('[REDIS] connection failed, continuing without cache:', err.message);
  }
}

async function cacheGet(key) {
  if (!connected) return null;
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch (err) {
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  if (!connected) return false;
  try {
    if (ttlSeconds) {
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } else {
      await client.set(key, JSON.stringify(value));
    }
    return true;
  } catch (err) {
    return false;
  }
}

function isConnected() {
  return connected;
}

module.exports = { client, connect, cacheGet, cacheSet, isConnected };
