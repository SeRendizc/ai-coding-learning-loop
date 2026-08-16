import {
  allocationForMode,
  canOpenGate,
  requiredGateLevels,
  validateDeliverRecord,
  validateGateCase,
  validateGateEvaluation,
  validateLearningContract,
} from './contracts.mjs'
import { replayLearningEvents } from './lifecycle.mjs'

function assertValid(errors, label) {
  if (errors.length > 0) throw new TypeError(`${label}: ${errors.join('; ')}`)
}

export function acceptLearningContract(contract) {
  assertValid(validateLearningContract(contract), 'invalid Learning Contract')
  return Object.freeze(structuredClone(contract))
}

export function buildWorkPlan(contract) {
  const accepted = acceptLearningContract(contract)
  const allocation = allocationForMode(accepted.mode)
  return Object.freeze(accepted.work_units.map(unit => Object.freeze({
    ...unit,
    implementation_owner: unit.implementation_owner ?? allocation.default_owner,
    required_gate_levels: requiredGateLevels(accepted.mode),
  })))
}

export function acceptDeliver(record) {
  assertValid(validateDeliverRecord(record), 'invalid Deliver Record')
  return Object.freeze(structuredClone(record))
}

export function bindGateCase(gateCase, deliver) {
  if (!canOpenGate(deliver)) throw new Error('cannot bind a Gate to an incomplete Deliver')
  assertValid(validateGateCase(gateCase, deliver), 'invalid Gate Case')
  return Object.freeze(structuredClone(gateCase))
}

export function acceptGateEvaluation(evaluation) {
  assertValid(validateGateEvaluation(evaluation), 'invalid Gate Evaluation')
  return Object.freeze(structuredClone(evaluation))
}

export function projectTask(taskId, events) {
  return replayLearningEvents(taskId, events)
}
