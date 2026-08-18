'use strict';

const registry = require('./registry');
const metrics = require('./metrics');
const { ERROR_CODES } = require('./errors');

/**
 * Resolve a capability into a concrete worker + model + provider.
 * Steps: filter enabled -> filter capability -> filter lifecycle -> sort by priority -> expose weight.
 */
function resolveCapability(capability, opts = {}) {
  const workers = registry.resolveWorkersForCapability(capability);
  if (!workers.length) {
    return { ok: false, code: ERROR_CODES.WORKER_UNAVAILABLE, message: `No enabled worker for capability: ${capability}` };
  }
  const worker = workers[0];

  // Prefer the worker's own configured provider/model if still selectable, else fall back
  // to the best capability-ranked model.
  const preferredModel = registry.getModel(worker.provider, worker.model);
  let model = null;
  if (preferredModel && registry.isModelSelectable(preferredModel, opts) && (preferredModel.capabilities || []).includes(capability)) {
    model = preferredModel;
  } else {
    const candidates = registry.resolveModelsForCapability(capability, opts);
    if (!candidates.length) {
      return { ok: false, code: ERROR_CODES.NO_CAPABLE_MODEL, message: `No capable model for capability: ${capability}` };
    }
    model = candidates[0];
  }

  const provider = registry.getProvider(model.provider);
  if (!provider || !provider.enabled) {
    return { ok: false, code: ERROR_CODES.NO_CAPABLE_PROVIDER, message: `No enabled provider for model: ${model.model}` };
  }

  metrics.providerResolutionsTotal.inc({ provider: provider.id });
  metrics.modelResolutionsTotal.inc({ provider: provider.id, model: model.model });

  return {
    ok: true,
    worker: worker.id,
    provider: provider.id,
    model: model.model,
    priority: model.priority,
    weight: model.weight,
    temperature: worker.temperature,
    max_tokens: worker.max_tokens
  };
}

module.exports = { resolveCapability };
