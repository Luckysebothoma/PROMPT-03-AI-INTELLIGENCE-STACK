'use strict';

const ERROR_CODES = Object.freeze({
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  CLASSIFICATION_FAILED: 'CLASSIFICATION_FAILED',
  WORKER_UNAVAILABLE: 'WORKER_UNAVAILABLE',
  NO_CAPABLE_MODEL: 'NO_CAPABLE_MODEL',
  NO_CAPABLE_PROVIDER: 'NO_CAPABLE_PROVIDER',
  RESPONSE_VALIDATION_FAILED: 'RESPONSE_VALIDATION_FAILED',
  MAX_ORCHESTRATION_DEPTH: 'MAX_ORCHESTRATION_DEPTH',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

const RETRYABLE = new Set([
  ERROR_CODES.PROVIDER_UNAVAILABLE,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.UPSTREAM_ERROR
]);

function normalizedError(code, message, extra = {}) {
  return {
    success: false,
    error: {
      code,
      message: message || code,
      retryable: RETRYABLE.has(code),
      ...extra
    }
  };
}

function sendError(res, httpStatus, code, message, extra = {}) {
  const body = normalizedError(code, message, extra);
  return res.status(httpStatus).json(body);
}

module.exports = { ERROR_CODES, normalizedError, sendError };
