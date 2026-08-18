import { sha256 } from './canonical.mjs'
import { REQUIRED_DELIVER_TOPICS, requiredGateLevels } from './contracts.mjs'

export const H07_TOOL_NAMES = Object.freeze([
  'ownership_submit_implementation',
  'ownership_record_verification',
  'ownership_complete_deliver',
  'ownership_open_gate',
  'ownership_record_gate_answer',
  'ownership_evaluate_gate',
])

export function latestEvent(events, type) {
  return [...events].reverse().find(event => event.type === type) ?? null
}

export function requireActiveWorkUnit(state) {
  const workUnitId = state?.active_work_unit_id
  if (typeof workUnitId !== 'string' || workUnitId.length === 0) {
    throw new Error('active work unit is unavailable')
  }
  return workUnitId
}

export function materializeDeliverRecord(context, events, input = {}) {
  const state = context?.state
  if (state?.phase !== 'DELIVERING') throw new Error('Deliver is not currently expected')
  const verification = latestEvent(events, 'work_unit.verified')
  if (verification?.payload?.result !== 'PASS') {
    throw new Error('Deliver requires passing engineering verification')
  }
  const workUnitId = requireActiveWorkUnit(state)
  const targetIds = (context.contract?.learning_targets ?? []).map(target => target.id)
  if (targetIds.length === 0) throw new Error('Deliver requires at least one learning target')
  const knownGaps = input.known_gaps ?? []
  if (!Array.isArray(knownGaps) || knownGaps.some(value => typeof value !== 'string')) {
    throw new TypeError('known_gaps must be a string array')
  }
  return Object.freeze({
    schema_version: 'ai-coding-learning-loop.deliver.v1',
    work_unit_id: workUnitId,
    implementation_ref: verification.payload.implementation_ref,
    verification_refs: [...verification.payload.verification_refs],
    topics_taught: [...REQUIRED_DELIVER_TOPICS],
    ready_for_gate: true,
    learning_targets: targetIds,
    known_gaps: [...knownGaps],
  })
}

function validateGateItems(items, deliver, requiredLevels) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('Gate items must be a non-empty array')
  const ids = new Set()
  const levels = new Set()
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('every Gate item must be an object')
    if (typeof item.id !== 'string' || item.id.length === 0) throw new TypeError('every Gate item requires id')
    if (ids.has(item.id)) throw new Error(`duplicate Gate item id: ${item.id}`)
    ids.add(item.id)
    if (!requiredLevels.includes(item.level)) throw new Error(`Gate item ${item.id} has unexpected level ${String(item.level)}`)
    if (levels.has(item.level)) throw new Error(`Gate level ${item.level} must appear exactly once`)
    levels.add(item.level)
    if (typeof item.deliver_topic !== 'string' || !deliver.topics_taught.includes(item.deliver_topic)) {
      throw new Error(`Gate item ${item.id} must bind to a taught Deliver topic`)
    }
    if (typeof item.prompt !== 'string' || item.prompt.trim().length === 0) throw new TypeError(`Gate item ${item.id} requires prompt`)
    if (!Array.isArray(item.rubric) || item.rubric.length === 0 || item.rubric.some(value => typeof value !== 'string' || value.length === 0)) {
      throw new TypeError(`Gate item ${item.id} requires a non-empty rubric`)
    }
    if (new Set(item.rubric).size !== item.rubric.length) throw new Error(`Gate item ${item.id} has duplicate rubric criteria`)
  }
  const missing = requiredLevels.filter(level => !levels.has(level))
  if (missing.length > 0) throw new Error(`Gate bundle is missing required levels: ${missing.join(', ')}`)
  if (levels.size !== requiredLevels.length) throw new Error('Gate bundle must cover each required level exactly once')
}

export function materializeCompositeGate(context, deliver, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Gate input must be an object')
  const requiredLevels = requiredGateLevels(context.contract.mode)
  validateGateItems(input.items, deliver, requiredLevels)
  const targetIds = deliver.learning_targets ?? []
  if (targetIds.length !== 1) throw new Error('H0 composite Gate currently requires exactly one taught learning target')
  const items = input.items.map(item => Object.freeze({
    id: item.id,
    level: item.level,
    deliver_topic: item.deliver_topic,
    prompt: item.prompt.trim(),
    rubric: [...item.rubric],
  }))
  const flattenedRubric = items.flatMap(item => item.rubric.map(criterion => `${item.id}::${criterion}`))
  const identity = {
    learning_target_id: targetIds[0],
    deliver_ref: deliver.implementation_ref,
    required_levels: requiredLevels,
    items,
  }
  const id = `gate-${sha256(identity).slice(7, 19)}`
  const prompt = items.map(item => `[${item.level}] ${item.prompt}`).join('\n\n')
  return Object.freeze({
    schema_version: 'ai-coding-learning-loop.gate-case.v1',
    id,
    level: requiredLevels.at(-1),
    learning_target_id: targetIds[0],
    deliver_topic: items[0].deliver_topic,
    deliver_ref: deliver.implementation_ref,
    prompt,
    rubric: flattenedRubric,
    composite_version: 'ai-coding-learning-loop.gate-bundle.v1',
    required_levels: [...requiredLevels],
    items,
  })
}

export function materializeCompositeGateEvaluation(input, gateCase) {
  if (gateCase?.composite_version !== 'ai-coding-learning-loop.gate-bundle.v1' || !Array.isArray(gateCase.items)) {
    throw new Error('active Gate is not an H0.7 composite Gate')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Gate evaluation must be an object')
  if (!['PASS', 'RETRY', 'BLOCK'].includes(input.result)) throw new TypeError('Gate result must be PASS, RETRY, or BLOCK')
  if (!Array.isArray(input.item_results)) throw new TypeError('item_results must be an array')
  const byId = new Map(input.item_results.map(result => [result?.item_id, result]))
  if (byId.size !== gateCase.items.length || input.item_results.length !== gateCase.items.length) {
    throw new Error('Gate evaluation must cover every Gate item exactly once')
  }
  const criterionResults = []
  for (const item of gateCase.items) {
    const result = byId.get(item.id)
    if (!result) throw new Error(`missing Gate item evaluation: ${item.id}`)
    if (result.level !== item.level) throw new Error(`Gate item ${item.id} level does not match the asked Gate`)
    if (!Array.isArray(result.criterion_results)) throw new TypeError(`Gate item ${item.id} criterion_results must be an array`)
    const criteria = new Map(result.criterion_results.map(entry => [entry?.criterion, entry]))
    if (criteria.size !== item.rubric.length || result.criterion_results.length !== item.rubric.length) {
      throw new Error(`Gate item ${item.id} must cover every rubric criterion exactly once`)
    }
    for (const criterion of item.rubric) {
      const entry = criteria.get(criterion)
      if (!entry || typeof entry.passed !== 'boolean') throw new Error(`Gate criterion is missing or invalid: ${item.id}::${criterion}`)
      criterionResults.push({ criterion: `${item.id}::${criterion}`, passed: entry.passed })
    }
  }
  if (input.result === 'PASS' && criterionResults.some(result => result.passed !== true)) {
    throw new Error('Gate PASS requires every item criterion to pass')
  }
  const gapCodes = input.gap_codes ?? []
  if (input.result !== 'PASS' && (!Array.isArray(gapCodes) || gapCodes.some(value => typeof value !== 'string'))) {
    throw new TypeError('non-PASS Gate evaluation requires gap_codes')
  }
  return Object.freeze({
    result: input.result,
    criterion_results: criterionResults,
    ...(input.result === 'PASS'
      ? { mastered_targets: [gateCase.learning_target_id] }
      : { gap_codes: [...gapCodes] }),
  })
}
