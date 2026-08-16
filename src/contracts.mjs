export const DELEGATION_MODES = Object.freeze([
  'GUIDED',
  'HUMAN_LED',
  'AI_LED',
  'DELEGATED',
])

export const LEARNING_LEVELS = Object.freeze(['EXPLAIN', 'PREDICT', 'APPLY'])

export const GATE_RESULTS = Object.freeze(['PASS', 'RETRY', 'BLOCK'])

export const ENGINEERING_RESULTS = Object.freeze(['PENDING', 'PASS', 'FAIL'])

export const LEARNING_RESULTS = Object.freeze([
  'UNTAUGHT',
  'DELIVERING',
  'GATE_PENDING',
  'MASTERED',
  'PARTIAL',
  'BLOCKED',
])

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

export const MODE_ALLOCATION = Object.freeze({
  GUIDED: Object.freeze({ default_owner: 'human', ai_role: 'coach' }),
  HUMAN_LED: Object.freeze({ default_owner: 'human', ai_role: 'scaffold-and-review' }),
  AI_LED: Object.freeze({ default_owner: 'ai', ai_role: 'implement-with-learning-anchors' }),
  DELEGATED: Object.freeze({ default_owner: 'ai', ai_role: 'implement-verify-and-teach' }),
})

export function requiredGateLevels(mode) {
  if (!DELEGATION_MODES.includes(mode)) {
    throw new TypeError(`unknown delegation mode: ${String(mode)}`)
  }
  return Object.freeze([...MODE_REQUIREMENTS[mode]])
}

export function allocationForMode(mode) {
  requiredGateLevels(mode)
  return MODE_ALLOCATION[mode]
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

  if (contract?.change_policy !== 'explicit-confirmation') {
    errors.push('change_policy must be explicit-confirmation')
  }

  const targetIds = new Set()

  for (const target of contract?.learning_targets ?? []) {
    if (typeof target.id !== 'string' || target.id.length === 0) {
      errors.push('every learning target requires a non-empty id')
    } else if (targetIds.has(target.id)) {
      errors.push(`duplicate learning target: ${target.id}`)
    }
    targetIds.add(target.id)
    if (!LEARNING_LEVELS.includes(target.mastery)) {
      errors.push(`learning target ${String(target.id)} has an invalid mastery level`)
    }
    if (!['human', 'ai'].includes(target.owner)) {
      errors.push(`learning target ${String(target.id)} has an invalid owner`)
    }
  }

  const unitIds = new Set()
  for (const unit of contract?.work_units ?? []) {
    if (typeof unit.id !== 'string' || unit.id.length === 0) {
      errors.push('every work unit requires a non-empty id')
    } else if (unitIds.has(unit.id)) {
      errors.push(`duplicate work unit: ${unit.id}`)
    }
    unitIds.add(unit.id)
    if (!['human', 'ai', 'pair'].includes(unit.implementation_owner)) {
      errors.push(`work unit ${String(unit.id)} has an invalid implementation_owner`)
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
  if (!Array.isArray(record?.learning_targets) || record.learning_targets.length === 0) {
    errors.push('learning_targets must identify what was taught')
  }
  if (!Array.isArray(record?.known_gaps)) errors.push('known_gaps must be an array')
  return errors
}

export function canOpenGate(record) {
  return validateDeliverRecord(record).length === 0
}

export function validateGateCase(gateCase, deliver) {
  const errors = []
  if (gateCase?.schema_version !== 'ai-coding-learning-loop.gate-case.v1') {
    errors.push('schema_version must be ai-coding-learning-loop.gate-case.v1')
  }
  if (!LEARNING_LEVELS.includes(gateCase?.level)) errors.push('gate level is invalid')
  if (!deliver?.learning_targets?.includes(gateCase?.learning_target_id)) {
    errors.push('gate learning target was not taught by the bound Deliver')
  }
  if (!deliver?.topics_taught?.includes(gateCase?.deliver_topic)) {
    errors.push('gate topic was not taught by the bound Deliver')
  }
  if (gateCase?.deliver_ref !== deliver?.implementation_ref) {
    errors.push('gate deliver_ref does not match the current implementation_ref')
  }
  if (!Array.isArray(gateCase?.rubric) || gateCase.rubric.length === 0) {
    errors.push('gate rubric must contain observable criteria')
  }
  return errors
}

export function validateGateEvaluation(evaluation) {
  const errors = []
  if (!GATE_RESULTS.includes(evaluation?.result)) errors.push('gate result is invalid')
  if (!Array.isArray(evaluation?.criterion_results) || evaluation.criterion_results.length === 0) {
    errors.push('criterion_results must explain the decision')
  }
  if (evaluation?.result !== 'PASS' && !Array.isArray(evaluation?.gap_codes)) {
    errors.push('non-PASS evaluation requires gap_codes')
  }
  return errors
}
