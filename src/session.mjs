import { sha256 } from './canonical.mjs'
import {
  acceptDeliver,
  acceptGateEvaluation,
  acceptLearningContract,
  bindGateCase,
  projectTask,
} from './core.mjs'
import { reduceLearningEvent } from './lifecycle.mjs'

function latest(events, type) {
  return [...events].reverse().find(event => event.type === type)
}

function freezeRecoveredState(state) {
  return Object.freeze({
    ...state,
    mastered_targets: Object.freeze([...state.mastered_targets]),
    unresolved_targets: Object.freeze([...state.unresolved_targets]),
  })
}

export class LearningSession {
  constructor(ledger) {
    this.ledger = ledger
  }

  async state(taskId) {
    const events = await this.ledger.read(taskId)
    try {
      const snapshot = await this.ledger.readSnapshot(taskId)
      if (snapshot) {
        const recovered = events.slice(snapshot.as_of_seq + 1).reduce(reduceLearningEvent, snapshot.state)
        return freezeRecoveredState(recovered)
      }
    } catch {
      // A snapshot is only a cache. Invalid cache evidence falls back to the
      // verified event log and never turns the task itself into a failure.
    }
    return projectTask(taskId, events)
  }

  async acceptContract(contract) {
    const accepted = acceptLearningContract(contract)
    const existing = await this.ledger.read(accepted.task_id)
    if (existing.length !== 0) throw new Error('task already has a Learning Contract')
    return this.ledger.append({
      task_id: accepted.task_id,
      type: 'contract.accepted',
      actor: 'user',
      payload: { contract: accepted, contract_sha256: sha256(accepted) },
    })
  }

  async brief(taskId, workUnitId, topics) {
    return this.ledger.append({
      task_id: taskId,
      type: 'work_unit.briefed',
      actor: 'agent',
      work_unit_id: workUnitId,
      payload: { work_unit_id: workUnitId, topics },
    })
  }

  async startWork(taskId, workUnitId) {
    return this.ledger.append({ task_id: taskId, type: 'work_unit.started', actor: 'runtime', work_unit_id: workUnitId })
  }

  async submitImplementation(taskId, workUnitId, implementationRef) {
    return this.ledger.append({
      task_id: taskId,
      type: 'work_unit.implementation_submitted',
      actor: 'agent',
      work_unit_id: workUnitId,
      refs: [implementationRef],
      payload: { implementation_ref: implementationRef },
    })
  }

  async recordVerification(taskId, workUnitId, result, implementationRef, verificationRefs) {
    if (!['PASS', 'FAIL'].includes(result)) throw new TypeError('verification result must be PASS or FAIL')
    return this.ledger.append({
      task_id: taskId,
      type: 'work_unit.verified',
      actor: 'verifier',
      work_unit_id: workUnitId,
      refs: [implementationRef, ...verificationRefs],
      payload: { result, implementation_ref: implementationRef, verification_refs: verificationRefs },
    })
  }

  async completeDeliver(taskId, record) {
    const accepted = acceptDeliver(record)
    const events = await this.ledger.read(taskId)
    const verification = latest(events, 'work_unit.verified')
    if (verification?.payload?.result !== 'PASS') throw new Error('Deliver requires passing engineering verification')
    if (verification.payload.implementation_ref !== accepted.implementation_ref) {
      throw new Error('Deliver implementation_ref does not match the verified implementation')
    }
    return this.ledger.append({
      task_id: taskId,
      type: 'deliver.completed',
      actor: 'agent',
      work_unit_id: accepted.work_unit_id,
      refs: [accepted.implementation_ref, ...accepted.verification_refs],
      payload: accepted,
    })
  }

  async askGate(taskId, gateCase) {
    const events = await this.ledger.read(taskId)
    const deliver = latest(events, 'deliver.completed')?.payload
    if (!deliver) throw new Error('Gate requires a completed Deliver')
    const bound = bindGateCase(gateCase, deliver)
    return this.ledger.append({
      task_id: taskId,
      type: 'gate.asked',
      actor: 'agent',
      work_unit_id: deliver.work_unit_id,
      refs: [bound.deliver_ref],
      payload: { gate_case: bound, gate_case_sha256: sha256(bound) },
    })
  }

  async evaluateGate(taskId, answer, evaluation) {
    const accepted = acceptGateEvaluation(evaluation)
    const events = await this.ledger.read(taskId)
    const contract = events.find(event => event.type === 'contract.accepted')?.payload?.contract
    const asked = latest(events, 'gate.asked')?.payload?.gate_case
    if (!contract || !asked) throw new Error('Gate answer has no active contract and question')
    const state = projectTask(taskId, events)
    if (state.phase !== 'AWAITING_GATE') throw new Error('Gate answer is not currently expected')
    const nextAttempt = state.gate_attempts + 1
    const exhausted = nextAttempt >= contract.gate.max_attempts && accepted.result === 'RETRY'
    const finalEvaluation = exhausted
      ? { ...accepted, result: 'BLOCK', gap_codes: accepted.gap_codes ?? ['attempts-exhausted'] }
      : accepted
    await this.ledger.append({
      task_id: taskId,
      type: 'gate.answered',
      actor: 'user',
      refs: [asked.id, asked.deliver_ref],
      payload: { gate_case_id: asked.id, answer_sha256: sha256(answer) },
    })
    return this.ledger.append({
      task_id: taskId,
      type: 'gate.evaluated',
      actor: 'verifier',
      refs: [asked.id, asked.deliver_ref],
      payload: { ...finalEvaluation, attempt: nextAttempt },
    })
  }

  async invalidateImplementation(taskId, nextImplementationRef) {
    const state = await this.state(taskId)
    if (!state.deliver_ref) throw new Error('there is no delivered implementation to invalidate')
    return this.ledger.append({
      task_id: taskId,
      type: 'implementation.invalidated',
      actor: 'runtime',
      refs: [state.deliver_ref, nextImplementationRef],
      payload: { previous_ref: state.deliver_ref, next_ref: nextImplementationRef },
    })
  }
}
