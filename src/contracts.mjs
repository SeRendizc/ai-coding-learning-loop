export const DELEGATION_MODES = Object.freeze([
  'GUIDED',
  'HUMAN_LED',
  'AI_LED',
  'DELEGATED',
])

export const LEARNING_LEVELS = Object.freeze(['EXPLAIN', 'PREDICT', 'APPLY'])

export const WORK_UNIT_STATES = Object.freeze([
  'DISCOVER',
  'CONTRACTED',
  'BRIEFED',
  'BUILDING',
  'VERIFYING',
  'DELIVERING',
  'AWAITING_GATE',
  'REVISING',
  'CLOSED',
])

export const REQUIRED_DELIVER_TOPICS = Object.freeze([
  'scope',
  'reading-order',
  'data-flow',
  'design-rationale',
  'invariants',
  'failure-paths',
  'verification',
  'prior-knowledge-link',
  'transfer-example',
  'known-gaps',
])

const MODE_REQUIREMENTS = Object.freeze({
  GUIDED: ['EXPLAIN'],
  HUMAN_LED: ['EXPLAIN', 'PREDICT'],
  AI_LED: ['EXPLAIN', 'PREDICT', 'APPLY'],
  DELEGATED: ['EXPLAIN', 'PREDICT', 'APPLY'],
})

export function requiredGateLevels(mode) {
  if (!DELEGATION_MODES.includes(mode)) {
    throw new TypeError(`unknown delegation mode: ${String(mode)}`)
  }
  return MODE_REQUIREMENTS[mode]
}

export function validateLearningContract(contract) {
  const errors = []
  if (contract?.schema_version !== 'ai-coding-learning-loop.learning-contract.v1') {
    errors.push('schema_version must be ai-coding-learning-loop.learning-contract.v1')
  }
  if (!DELEGATION_MODES.includes(contract?.mode)) {
    errors.push('mode must be a supported delegation mode')
  }
  if (!Array.isArray(contract?.learning_targets) || contract.learning_targets.length === 0) {
    errors.push('learning_targets must contain at least one target')
  }
  if (!Array.isArray(contract?.work_units) || contract.work_units.length === 0) {
    errors.push('work_units must contain at least one unit')
  }
  if (!Number.isInteger(contract?.gate?.max_attempts) || contract.gate.max_attempts < 1) {
    errors.push('gate.max_attempts must be a positive integer')
  }

  for (const target of contract?.learning_targets ?? []) {
    if (!LEARNING_LEVELS.includes(target.mastery)) {
      errors.push(`learning target ${String(target.id)} has an invalid mastery level`)
    }
  }

  return errors
}

export function validateDeliverRecord(record) {
  const errors = []
  if (record?.schema_version !== 'ai-coding-learning-loop.deliver.v1') {
    errors.push('schema_version must be ai-coding-learning-loop.deliver.v1')
  }
  if (!record?.implementation_ref) errors.push('implementation_ref is required')
  if (!Array.isArray(record?.verification_refs) || record.verification_refs.length === 0) {
    errors.push('verification_refs must contain verified engineering evidence')
  }
  const topics = new Set(record?.topics_taught ?? [])
  for (const topic of REQUIRED_DELIVER_TOPICS) {
    if (!topics.has(topic)) errors.push(`missing Deliver topic: ${topic}`)
  }
  if (record?.ready_for_gate !== true) errors.push('ready_for_gate must be true')
  return errors
}

export function canOpenGate(record) {
  return validateDeliverRecord(record).length === 0
}
