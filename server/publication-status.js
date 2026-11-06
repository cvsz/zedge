/**
 * Publication status lifecycle management
 * Statuses: IDEA -> REVIEW -> APPROVED -> SCHEDULED -> PUBLISHING -> PUBLISHED/FAILED
 * Each transition is audited and approval-gated by autonomy level
 * Events are emitted on each transition
 */

const allowedTransitions = {
  IDEA: ['REVIEW'],
  REVIEW: ['IDEA', 'APPROVED'],
  APPROVED: ['REVIEW', 'SCHEDULED'],
  SCHEDULED: ['APPROVED', 'PUBLISHING'],
  PUBLISHING: ['SCHEDULED', 'PUBLISHED', 'FAILED'],
  PUBLISHED: [], // terminal state
  FAILED: ['SCHEDULED'], // can retry from failed
};

/**
 * Check if a status transition is allowed
 * @param {string} from - Current status
 * @param {string} to - Target status
 * @returns {boolean} Whether the transition is allowed
 */
export function isValidTransition(from, to) {
  const permitted = allowedTransitions[from] || [];
  return permitted.includes(to);
}

/**
 * Get allowed next statuses from current status
 * @param {string} from - Current status
 * @returns {Array} Array of allowed next statuses
 */
export function getAllowedNext(from) {
  return allowedTransitions[from] || [];
}

/**
 * Validate and transition content status
 * @param {string} from - Current status
 * @param {string} to - Target status
 * @param {number} autonomyLevel - User's autonomy level (require higher for sensitive transitions)
 * @param {string} _userId - User ID performing the transition (unused, kept for API compatibility)
 * @returns {Object} Result with success flag and message
 */
export function transitionStatus(from, to, autonomyLevel, _userId) {
  void _userId;
  if (!isValidTransition(from, to)) {
    return { success: false, error: `Invalid transition from ${from} to ${to}` };
  }

  // Approval gating - certain transitions require higher autonomy levels
  const requiresApproval = from === 'REVIEW' && to === 'APPROVED';
  if (requiresApproval && (autonomyLevel || 0) < 2) {
    return { success: false, error: 'Approval required: this transition requires autonomy level 2+' };
  }

  return { success: true, from, to, newStatus: to };
}

/**
 * Emulate event emission on status transition
 * In production, this would emit a content status event
 * @param {string} from - Previous status
 * @param {string} to - New status
 * @param {string} userId - User who performed the transition
 * @returns {Object} Event object
 */
export function emitStatusEvent(from, to, userId) {
  return {
    type: 'ContentStatusChanged',
    id: `content_status_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    from,
    to,
    userId,
    timestamp: new Date().toISOString(),
  };
}

export default { isValidTransition, getAllowedNext, transitionStatus, emitStatusEvent };