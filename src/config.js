'use strict';

require('dotenv').config();

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON array`);
    }
    return parsed;
  } catch (err) {
    // FAIL FAST on invalid configuration
    // eslint-disable-next-line no-console
    console.error(`[CONFIG FATAL] Invalid JSON in ${name}: ${err.message}`);
    process.exit(1);
  }
}

const DEFAULT_PROVIDERS = [
  {
    id: 'groq',
    enabled: true,
    priority: 10,
    weight: 100,
    api_type: 'openai-compatible',
    authentication_env: 'GROQ_API_KEY'
  },
  {
    id: 'gemini',
    enabled: true,
    priority: 20,
    weight: 90,
    api_type: 'gemini',
    authentication_env: 'GEMINI_API_KEY'
  }
];

const DEFAULT_MODELS = [
  {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    enabled: true,
    priority: 10,
    weight: 100,
    lifecycle: 'stable',
    capabilities: ['chat', 'reasoning', 'code'],
    modalities: ['text'],
    context_window: 131072,
    max_output_tokens: 8000,
    streaming_supported: true,
    vision_supported: false,
    tools_supported: true
  },
  {
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    enabled: true,
    priority: 10,
    weight: 100,
    lifecycle: 'stable',
    capabilities: ['chat', 'classification'],
    modalities: ['text'],
    context_window: 131072,
    max_output_tokens: 4000,
    streaming_supported: true,
    vision_supported: false,
    tools_supported: true
  },
  {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    enabled: true,
    priority: 20,
    weight: 90,
    lifecycle: 'stable',
    capabilities: ['chat', 'reasoning', 'vision', 'image_understanding', 'summarization', 'extraction', 'translation'],
    modalities: ['text', 'image'],
    context_window: 1048576,
    max_output_tokens: 8192,
    streaming_supported: true,
    vision_supported: true,
    tools_supported: true
  }
];

const DEFAULT_WORKERS = [
  {
    id: 'intent-classifier',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    capabilities: ['classification'],
    temperature: 0.1,
    max_tokens: 300,
    status: 'active'
  },
  {
    id: 'chat-worker',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    capabilities: ['chat'],
    temperature: 0.5,
    max_tokens: 1000,
    status: 'active'
  },
  {
    id: 'vision-worker',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    capabilities: ['vision', 'image_understanding', 'image_identification'],
    temperature: 0.3,
    max_tokens: 1000,
    status: 'active'
  },
  {
    id: 'code-worker',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    capabilities: ['code', 'reasoning'],
    temperature: 0.2,
    max_tokens: 2000,
    status: 'active'
  },
  {
    id: 'reasoning-worker',
    enabled: true,
    priority: 20,
    weight: 90,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    capabilities: ['reasoning'],
    temperature: 0.3,
    max_tokens: 1500,
    status: 'active'
  },
  {
    id: 'summarization-worker',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    capabilities: ['summarization'],
    temperature: 0.3,
    max_tokens: 1000,
    status: 'active'
  },
  {
    id: 'extraction-worker',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    capabilities: ['extraction'],
    temperature: 0.1,
    max_tokens: 1000,
    status: 'active'
  },
  {
    id: 'translation-worker',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    capabilities: ['translation'],
    temperature: 0.2,
    max_tokens: 1000,
    status: 'active'
  },
  {
    id: 'response-validator',
    enabled: true,
    priority: 10,
    weight: 100,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    capabilities: ['validation'],
    temperature: 0,
    max_tokens: 200,
    status: 'active'
  }
];

const DEFAULT_CREDENTIALS = [
  {
    provider: 'groq',
    credentials: [
      { id: 'groq-primary', enabled: true, priority: 10, weight: 100, secret_env: 'GROQ_API_KEY_1' },
      { id: 'groq-secondary', enabled: !!process.env.GROQ_API_KEY_2, priority: 20, weight: 50, secret_env: 'GROQ_API_KEY_2' }
    ]
  },
  {
    provider: 'gemini',
    credentials: [
      { id: 'gemini-primary', enabled: true, priority: 10, weight: 100, secret_env: 'GEMINI_API_KEY_1' },
      { id: 'gemini-secondary', enabled: !!process.env.GEMINI_API_KEY_2, priority: 20, weight: 50, secret_env: 'GEMINI_API_KEY_2' }
    ]
  }
];

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'production',

  day3Url: process.env.DAY3_URL || 'http://192.168.0.140:4405',
  day4Url: process.env.DAY4_URL || 'http://127.0.0.1:4406',

  postgres: {
    host: process.env.POSTGRES_HOST || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'ai_gateway',
    password: process.env.POSTGRES_PASSWORD || 'ai_gateway_password',
    database: process.env.POSTGRES_DB || 'ai_gateway_day5'
  },

  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined
  },

  maxOrchestrationDepth: parseInt(process.env.MAX_ORCHESTRATION_DEPTH || '3', 10),

  providers: parseJsonEnv('AI_PROVIDERS_JSON', DEFAULT_PROVIDERS),
  models: parseJsonEnv('AI_MODELS_JSON', DEFAULT_MODELS),
  workers: parseJsonEnv('AI_WORKERS_JSON', DEFAULT_WORKERS),
  credentials: parseJsonEnv('AI_CREDENTIALS_JSON', DEFAULT_CREDENTIALS)
};

module.exports = config;
