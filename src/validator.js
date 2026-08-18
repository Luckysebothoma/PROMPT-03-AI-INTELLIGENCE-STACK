'use strict';

const metrics = require('./metrics');

/**
 * Structural validation only - NOT hallucination detection.
 * Checks: response exists, is not empty, provider/model metadata exists, request_id exists.
 */
function validateResponse({ responseText, provider, model, request_id }) {
  metrics.responseValidationTotal.inc();

  if (!request_id) {
    metrics.responseValidationFailuresTotal.inc();
    return { valid: false, reason: 'Missing request_id' };
  }
  if (!provider || !model) {
    metrics.responseValidationFailuresTotal.inc();
    return { valid: false, reason: 'Missing provider/model metadata' };
  }
  if (!responseText || typeof responseText !== 'string' || responseText.trim() === '') {
    metrics.responseValidationFailuresTotal.inc();
    return { valid: false, reason: 'Response is empty' };
  }

  return { valid: true, reason: 'Response passed structural validation' };
}

module.exports = { validateResponse };
