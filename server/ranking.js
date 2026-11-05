/**
 * Catalog, offers and ranking - Phase 1 scope
 * Ranking consumer with `observed` and `modeled` kept apart
 * Emits ProductRanked events
 */

const rankingCache = new Map();
const productRankedEvents = [];

/**
 * Ranking observation data - raw metrics observed from platform APIs
 * Kept separate from modeled data
 * @type {Array<Object>}
 */
let observedData = [];

/**
 * Modeled ranking data - derived/calculated rankings
 * Kept separate from observed data to avoid base mixing
 * @type {Array<Object>}
 */
let modeledData = [];

/**
 * Record observed ranking data from platform API responses
 * @param {Object} options - Observation options
 * @param {string} options.productId - Product identifier
 * @param {number} options.position - Search position
 * @param {number} options.score - Ranking score
 * @param {Object} options.metadata - Additional metadata (platform, timestamp, etc)
 */
/** @param {{ productId?: string, position?: number, score?: number, metadata?: Object }} options */
export function recordObserved({ productId, position, score, metadata } = {}) {
  observedData.push({
    id: `obs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    productId,
    position,
    score,
    metadata: { ...metadata, observedAt: new Date().toISOString() },
  });

  // Keep observed and modeled separate - no mixing
  maybeEmitProductRanked();
  return observedData[observedData.length - 1];
}

/**
 * Record modeled ranking data - derived ranking position
 * @param {Object} options - Modeling options
 * @param {string} options.productId - Product identifier
 * @param {number} options.rank - Calculated rank
 * @param {number} options.factor - Ranking factor used
 * @param {Object} options.metadata - Additional metadata
 */
/** @param {{ productId?: string, rank?: number, factor?: number, metadata?: Object }} options */
export function recordModeled({ productId, rank, factor, metadata } = {}) {
  modeledData.push({
    id: `model_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    productId,
    rank,
    factor,
    metadata: { ...metadata, modeledAt: new Date().toISOString() },
  });

  // Keep observed and modeled separate - no mixing
  maybeEmitProductRanked();
  return modeledData[modeledData.length - 1];
}

/**
 * Check that observed and modeled data don't mix bases
 * @returns {boolean} Whether data is clean (no mixing)
 */
function isDataClean() {
  // Verify no product appears in both observed and modeled with different bases
  const obsProducts = new Set(observedData.map((d) => d.productId));
  const modelProducts = new Set(modeledData.map((d) => d.productId));
  const overlap = [...obsProducts].filter((id) => modelProducts.has(id));

  // If there's overlap, verify they have the same rank (no mixing)
  if (overlap.length > 0) {
    for (const productId of overlap) {
      const obsEntry = observedData.find((d) => d.productId === productId);
      const modelEntry = modeledData.find((d) => d.productId === productId);
      if (obsEntry && modelEntry && obsEntry.position !== modelEntry.rank) {
        return false; // Mixing detected - same product, different ranks
      }
    }
  }
  return true;
}

/**
 * Emit ProductRanked event when appropriate
 * Done when ranking is reproducible from fixture, never mixes bases
 */
function maybeEmitProductRanked() {
  if (!isDataClean()) {
    // Data is mixed - don't emit until cleaned
    return;
  }

  // Check if we have enough data to emit a ProductRanked event
  if (observedData.length === 0 || modeledData.length === 0) {
    return; // Need data from both sides
  }

  // Emit ProductRanked event for the first product that has both observed and modeled
  const productIds = new Set([
    ...observedData.map((d) => d.productId),
    ...modeledData.map((d) => d.productId),
  ]);

  for (const productId of productIds) {
    const obsEntry = observedData.find((d) => d.productId === productId);
    const modelEntry = modeledData.find((d) => d.productId === productId);

    if (obsEntry && modelEntry) {
      const event = {
        type: 'ProductRanked',
        id: `product_ranked_${productId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        productId,
        observedPosition: obsEntry.position,
        modeledRank: modelEntry.rank,
        observedAt: obsEntry.metadata?.observedAt,
        modeledAt: modelEntry.metadata?.modeledAt,
        timestamp: new Date().toISOString(),
      };

      productRankedEvents.push(event);
      break; // Only emit one event per cycle for simplicity
    }
  }
}

/**
 * Get all ProductRanked events emitted
 * @returns {Array} Array of ProductRanked events
 */
export function getProductRankedEvents() {
  return [...productRankedEvents];
}

/**
 * Get observed data
 * @returns {Array} Array of observed data entries
 */
export function getObservedData() {
  return [...observedData];
}

/**
 * Get modeled data
 * @returns {Array} Array of modeled data entries
 */
export function getModeledData() {
  return [...modeledData];
}

/**
 * Clear all data (for test cleanup)
 */
export function clear() {
  rankingCache.clear();
  productRankedEvents.length = 0;
  observedData.length = 0;
  modeledData.length = 0;
}

export default { recordObserved, recordModeled, getProductRankedEvents, getObservedData, getModeledData, clear, isDataClean };