'use strict';

const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

function counter(name, help, labelNames = []) {
  const c = new client.Counter({ name, help, labelNames });
  register.registerMetric(c);
  return c;
}

const metrics = {
  register,
  chatRequestsTotal: counter('chat_requests_total', 'Total /v1/chat requests'),
  classificationRequestsTotal: counter('classification_requests_total', 'Total /v1/classify requests'),
  resolutionRequestsTotal: counter('resolution_requests_total', 'Total /v1/resolve requests'),
  executionRequestsTotal: counter('execution_requests_total', 'Total /v1/execute requests'),

  workerRequestsTotal: counter('worker_requests_total', 'Total worker invocations', ['worker']),
  workerFailuresTotal: counter('worker_failures_total', 'Total worker failures', ['worker']),

  providerResolutionsTotal: counter('provider_resolutions_total', 'Total provider resolutions', ['provider']),
  modelResolutionsTotal: counter('model_resolutions_total', 'Total model resolutions', ['provider', 'model']),

  providerErrorsTotal: counter('provider_errors_total', 'Total provider errors', ['provider']),
  modelErrorsTotal: counter('model_errors_total', 'Total model errors', ['provider', 'model']),

  normalizedErrorsTotal: counter('normalized_errors_total', 'Total normalized errors', ['code']),

  orchestrationDepthExceededTotal: counter('orchestration_depth_exceeded_total', 'Total requests that exceeded max depth'),

  responseValidationTotal: counter('response_validation_total', 'Total response validations'),
  responseValidationFailuresTotal: counter('response_validation_failures_total', 'Total response validation failures'),

  redisCacheHits: counter('redis_cache_hits_total', 'Total redis cache hits'),
  redisCacheMisses: counter('redis_cache_misses_total', 'Total redis cache misses')
};

module.exports = metrics;
