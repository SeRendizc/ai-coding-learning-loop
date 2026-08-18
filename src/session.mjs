import { sha256 } from './canonical.mjs'
import {
  acceptDeliver,
  acceptGateEvaluation,
  acceptLearningContract,
  acceptPlan,
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

  async context(taskId) {
    const { contract, events, state } = await this.#contractAndState(taskId)
    const submitted = latest(events, 'plan.submitted')
    const reviewed = latest(events, 'plan.reviewed')
    const latestPlanReviewDecision = submitted && reviewed?.payload?.plan_ref === submitted.payload.plan_ref
      ? reviewed.payload.decision
      : null
    return Object.freeze({
      contract: Object.freeze(structuredClone(contract)),
      state: freezeRecoveredState(structuredClone(state)),
      latest_plan: submitted?.payload?.plan ? Object.freeze(structuredClone(submitted.payload.plan)) : null,
      latest_plan_ref: submitted?.payload?.plan_ref ?? null,
      latest_plan_review_decision: latestPlanReviewDecision,
    })
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

  async #appendProjected(input) {
    const events = await this.ledger.read(input.task_id)
    const state = projectTask(input.task_id, events)
    reduceLearningEvent(state, input)
    return this.ledger.append(input)
  }

  async #contractAndState(taskId) {
    const events = await this.ledger.read(taskId)
    const contract = events.find(event => event.type === 'contract.accepted')?.payload?.contract
    if (!contract) throw new Error('task has no accepted Learning Contract')
    return { contract, events, state: projectTask(taskId, events) }
  }

  async #requireWorkUnit(taskId, workUnitId) {
    const current = await this.#contractAndState(taskId)
    if (!current.contract.work_units.some(unit => unit.id === workUnitId)) {
      throw new Error(`unknown work unit: ${String(workUnitId)}`)
    }
    if (current.state.active_work_unit_id && current.state.active_work_unit_id !== workUnitId) {
      throw new Error(`active work unit is ${current.state.active_work_unit_id}`)
    }
    return current
  }

  async brief(taskId, workUnitId, topics) {
    await this.#requireWorkUnit(taskId, workUnitId)
    return this.#appendProjected({
      task_id: taskId,
      type: 'work_unit.briefed',
      actor: 'agent',
      work_unit_id: workUnitId,
      payload: { work_unit_id: workUnitId, topics },
    })
  }

  async startWork(taskId, workUnitId) {
    await this.#requireWorkUnit(taskId, workUnitId)
    return this.#appendProjected({ task_id: taskId, type: 'work_unit.started', actor: 'runtime', work_unit_id: workUnitId })
  }

  async startPlan(taskId, workUnitId) {
    await this.#requireWorkUnit(taskId, workUnitId)
    return this.#appendProjected({
      task_id: taskId,
      type: 'plan.started',
      actor: 'agent',
      work_unit_id: workUnitId,
      payload: { work_unit_id: workUnitId },
    })
  }

  async submitPlan(taskId, record, userMessageCountAtSubmit = null) {
    if (userMessageCountAtSubmit !== null
      && (!Number.isSafeInteger(userMessageCountAtSubmit) || userMessageCountAtSubmit < 0)) {
      throw new TypeError('userMessageCountAtSubmit must be a non-negative safe integer')
    }
    const accepted = acceptPlan(record)
    const { state } = await this.#requireWorkUnit(taskId, accepted.work_unit_id)
    if (state.phase !== 'PLANNING') throw new Error('Plan is not currently expected')
    const planRef = sha256(accepted)
    return this.#appendProjected({
      task_id: taskId,
      type: 'plan.submitted',
      actor: 'agent',
      work_unit_id: accepted.work_unit_id,
      refs: [planRef],
      payload: {
        plan: accepted,
        plan_ref: planRef,
        ...(userMessageCountAtSubmit === null ? {} : { user_message_count_at_submit: userMessageCountAtSubmit }),
      },
    })
  }

  async recordPlanReview(taskId, decision, currentUserMessageCount = null, reviewSource = 'direct-message') {
    if (!['APPROVE', 'REVISE', 'REJECT'].includes(decision)) {
      throw new TypeError('Plan review decision must be APPROVE, REVISE, or REJECT')
    }
    if (!['direct-message', 'user-question'].includes(reviewSource)) {
      throw new TypeError('Plan review source must be direct-message or user-question')
    }
    if (currentUserMessageCount !== null
      && (!Number.isSafeInteger(currentUserMessageCount) || currentUserMessageCount < 0)) {
      throw new TypeError('currentUserMessageCount must be a non-negative safe integer')
    }
    const { events, state } = await this.#contractAndState(taskId)
    if (state.phase !== 'AWAITING_PLAN_REVIEW') throw new Error('Plan review is not currently expected')
    const submitted = latest(events, 'plan.submitted')
    const boundary = submitted?.payload?.user_message_count_at_submit
    if (reviewSource === 'direct-message' && boundary !== undefined
      && (!Number.isSafeInteger(currentUserMessageCount) || currentUserMessageCount <= boundary)) {
      throw new Error('Plan review requires a new direct user message after the Plan')
    }
    return this.#appendProjected({
      task_id: taskId,
      type: 'plan.reviewed',
      actor: 'user',
      work_unit_id: submitted.work_unit_id,
      refs: [submitted.payload.plan_ref],
      payload: {
        decision,
        plan_ref: submitted.payload.plan_ref,
        ...(currentUserMessageCount === null ? {} : { user_message_count_at_review: currentUserMessageCount }),
      },
    })
  }

  async reopenPlan(taskId, currentUserMessageCount) {
    if (!Number.isSafeInteger(currentUserMessageCount) || currentUserMessageCount < 1) {
      throw new TypeError('currentUserMessageCount must include a direct user replan request')
    }
    const { events, state } = await this.#contractAndState(taskId)
    if (state.phase !== 'PLAN_REJECTED') throw new Error('Rejected Plan is not currently reopenable')
    const reviewed = latest(events, 'plan.reviewed')
    if (reviewed?.payload?.decision !== 'REJECT') throw new Error('Plan reopen requires a rejected Plan')
    const submitted = latest(events, 'plan.submitted')
    const boundary = reviewed.payload.user_message_count_at_review
      ?? submitted?.payload?.user_message_count_at_submit
    if (boundary !== undefined && currentUserMessageCount <= boundary) {
      throw new Error('Plan replan requires a new direct user message after rejection')
    }
    return this.#appendProjected({
      task_id: taskId,
      type: 'plan.reopened',
      actor: 'user',
      work_unit_id: reviewed.work_unit_id,
      refs: [reviewed.payload.plan_ref],
      payload: { previous_plan_ref: reviewed.payload.plan_ref },
    })
  }

  async submitImplementation(taskId, workUnitId, implementationRef) {
    await this.#requireWorkUnit(taskId, workUnitId)
    return this.#appendProjected({
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
    await this.#requireWorkUnit(taskId, workUnitId)
    return this.#appendProjected({
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
    const { events, state } = await this.#requireWorkUnit(taskId, accepted.work_unit_id)
    if (state.phase !== 'DELIVERING') throw new Error('Deliver is not currently expected')
    const verification = latest(events, 'work_unit.verified')
    if (verification?.payload?.result !== 'PASS') throw new Error('Deliver requires passing engineering verification')
    if (verification.payload.implementation_ref !== accepted.implementation_ref) {
      throw new Error('Deliver implementation_ref does not match the verified implementation')
    }
    return this.#appendProjected({
      task_id: taskId,
      type: 'deliver.completed',
      actor: 'agent',
      work_unit_id: accepted.work_unit_id,
      refs: [accepted.implementation_ref, ...accepted.verification_refs],
      payload: accepted,
    })
  }

  async askGate(taskId, gateCase, userMessageCountAtAsk = null) {
    if (userMessageCountAtAsk !== null && (!Number.isSafeInteger(userMessageCountAtAsk) || userMessageCountAtAsk < 0)) {
      throw new TypeError('userMessageCountAtAsk must be a non-negative safe integer')
    }
    const { events, state } = await this.#contractAndState(taskId)
    if (state.phase !== 'AWAITING_GATE') throw new Error('Gate is not currently expected')
    const deliver = latest(events, 'deliver.completed')?.payload
    if (!deliver) throw new Error('Gate requires a completed Deliver')
    const asked = latest(events, 'gate.asked')
    const evaluated = latest(events, 'gate.evaluated')
    if (asked && (!evaluated || evaluated.seq < asked.seq)) throw new Error('an unanswered Gate is already active')
    const bound = bindGateCase(gateCase, deliver)
    return this.ledger.append({
      task_id: taskId,
      type: 'gate.asked',
      actor: 'agent',
      work_unit_id: deliver.work_unit_id,
      refs: [bound.deliver_ref],
      payload: {
        gate_case: bound,
        gate_case_sha256: sha256(bound),
        ...(userMessageCountAtAsk === null ? {} : { user_message_count_at_ask: userMessageCountAtAsk }),
      },
    })
  }

  async recordGateAnswer(taskId, currentUserMessageCount = null) {
    const { events, state } = await this.#contractAndState(taskId)
    if (state.phase !== 'AWAITING_GATE') throw new Error('Gate answer is not currently expected')
    const askedEvent = latest(events, 'gate.asked')
    const asked = askedEvent?.payload?.gate_case
    if (!asked) throw new Error('Gate answer has no active question')
    const boundary = askedEvent.payload.user_message_count_at_ask
    if (boundary !== undefined
      && (!Number.isSafeInteger(currentUserMessageCount) || currentUserMessageCount <= boundary)) {
      throw new Error('Gate answer requires a new direct user message after the Gate question')
    }
    const answered = latest(events, 'gate.answered')
    if (answered && answered.seq > askedEvent.seq) throw new Error('the active Gate already has an answer')
    return this.ledger.append({
      task_id: taskId,
      type: 'gate.answered',
      actor: 'user',
      refs: [asked.id, asked.deliver_ref],
      payload: { gate_case_id: asked.id, response_observed: true },
    })
  }

  async evaluateGateDecision(taskId, evaluation) {
    const accepted = acceptGateEvaluation(evaluation)
    const { contract, events, state } = await this.#contractAndState(taskId)
    const askedEvent = latest(events, 'gate.asked')
    const asked = askedEvent?.payload?.gate_case
    if (!contract || !asked) throw new Error('Gate answer has no active contract and question')
    if (state.phase !== 'AWAITING_GATE') throw new Error('Gate answer is not currently expected')
    const answered = latest(events, 'gate.answered')
    const evaluated = latest(events, 'gate.evaluated')
    if (!answered || answered.seq < askedEvent.seq) throw new Error('Gate evaluation requires the current user answer')
    if (evaluated && evaluated.seq > askedEvent.seq) throw new Error('the active Gate is already evaluated')
    const expectedCriteria = new Set(asked.rubric)
    const actualCriteria = new Set(accepted.criterion_results.map(result => result.criterion))
    if (actualCriteria.size !== expectedCriteria.size
      || [...expectedCriteria].some(criterion => !actualCriteria.has(criterion))) {
      throw new Error('Gate evaluation must cover every exact rubric criterion once')
    }
    if (accepted.criterion_results.length !== actualCriteria.size) {
      throw new Error('Gate evaluation contains duplicate rubric criteria')
    }
    if (accepted.result === 'PASS') {
      if (accepted.criterion_results.some(result => result.passed !== true)) {
        throw new Error('Gate PASS requires every rubric criterion to pass')
      }
      if (!accepted.mastered_targets?.includes(asked.learning_target_id)) {
        throw new Error('Gate PASS must master the Gate learning target')
      }
    }
    const nextAttempt = state.gate_attempts + 1
    const exhausted = nextAttempt >= contract.gate.max_attempts && accepted.result === 'RETRY'
    const finalEvaluation = exhausted
      ? { ...accepted, result: 'BLOCK', gap_codes: accepted.gap_codes ?? ['attempts-exhausted'] }
      : accepted
    return this.#appendProjected({
      task_id: taskId,
      type: 'gate.evaluated',
      actor: 'verifier',
      refs: [asked.id, asked.deliver_ref],
      payload: { ...finalEvaluation, attempt: nextAttempt },
    })
  }

  async evaluateGate(taskId, _answer, evaluation) {
    await this.recordGateAnswer(taskId)
    return this.evaluateGateDecision(taskId, evaluation)
  }

  async startRevision(taskId, workUnitId) {
    await this.#requireWorkUnit(taskId, workUnitId)
    return this.#appendProjected({
      task_id: taskId,
      type: 'work_unit.revision_started',
      actor: 'agent',
      work_unit_id: workUnitId,
    })
  }

  async invalidateImplementation(taskId, nextImplementationRef) {
    const state = await this.state(taskId)
    if (!state.deliver_ref) throw new Error('there is no delivered implementation to invalidate')
    return this.#appendProjected({
      task_id: taskId,
      type: 'implementation.invalidated',
      actor: 'runtime',
      refs: [state.deliver_ref, nextImplementationRef],
      payload: { previous_ref: state.deliver_ref, next_ref: nextImplementationRef },
    })
  }
}
