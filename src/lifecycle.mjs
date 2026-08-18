const ALLOWED = Object.freeze({
  DISCOVER: new Set(['CONTRACTED']),
  CONTRACTED: new Set(['BRIEFED']),
  BRIEFED: new Set(['PLANNING']),
  PLANNING: new Set(['AWAITING_PLAN_REVIEW']),
  AWAITING_PLAN_REVIEW: new Set(['PLAN_APPROVED', 'PLANNING', 'PLAN_REJECTED']),
  PLAN_APPROVED: new Set(['BUILDING']),
  PLAN_REJECTED: new Set(),
  BUILDING: new Set(['VERIFYING']),
  VERIFYING: new Set(['DELIVERING', 'REVISING']),
  DELIVERING: new Set(['AWAITING_GATE']),
  AWAITING_GATE: new Set(['CLOSED', 'DELIVERING']),
  REVISING: new Set(['BUILDING', 'DELIVERING']),
  CLOSED: new Set(),
})

export function initialLearningState(taskId) {
  if (typeof taskId !== 'string' || taskId.length === 0) throw new TypeError('taskId is required')
  return Object.freeze({
    task_id: taskId,
    phase: 'DISCOVER',
    engineering_status: 'PENDING',
    learning_status: 'UNTAUGHT',
    active_work_unit_id: null,
    plan_ref: null,
    plan_review_attempts: 0,
    deliver_ref: null,
    gate_attempts: 0,
    mastered_targets: Object.freeze([]),
    unresolved_targets: Object.freeze([]),
    closed: false,
  })
}

export function transition(state, next, evidence = {}) {
  if (!ALLOWED[state]?.has(next)) {
    throw new Error(`illegal transition: ${String(state)} -> ${String(next)}`)
  }
  if (state === 'VERIFYING' && next === 'DELIVERING' && evidence.engineering !== 'PASS') {
    throw new Error('Deliver requires passing engineering verification')
  }
  if (state === 'DELIVERING' && next === 'AWAITING_GATE' && evidence.deliver !== 'COMPLETE') {
    throw new Error('Gate requires a complete teaching Deliver')
  }
  if (state === 'AWAITING_GATE' && next === 'CLOSED' && evidence.learning !== 'PASS') {
    throw new Error('Closing requires passing learning evidence')
  }
  return next
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    mastered_targets: Object.freeze([...state.mastered_targets]),
    unresolved_targets: Object.freeze([...state.unresolved_targets]),
  })
}

export function reduceLearningEvent(state, event) {
  const payload = event?.payload ?? {}
  switch (event?.type) {
    case 'contract.accepted':
      if (state.phase !== 'DISCOVER') throw new Error('contract can only be accepted from DISCOVER')
      return freezeState({ ...state, phase: 'CONTRACTED' })
    case 'work_unit.briefed':
      if (!['CONTRACTED', 'CLOSED'].includes(state.phase)) throw new Error('brief requires a contracted boundary')
      return freezeState({
        ...state,
        phase: 'BRIEFED',
        active_work_unit_id: payload.work_unit_id,
        plan_ref: null,
        plan_review_attempts: 0,
        engineering_status: 'PENDING',
        learning_status: 'UNTAUGHT',
        deliver_ref: null,
        gate_attempts: 0,
        closed: false,
      })
    case 'work_unit.started':
      return freezeState({ ...state, phase: transition(state.phase, 'BUILDING') })
    case 'plan.started':
      return freezeState({ ...state, phase: transition(state.phase, 'PLANNING') })
    case 'plan.submitted':
      return freezeState({
        ...state,
        phase: transition(state.phase, 'AWAITING_PLAN_REVIEW'),
        plan_ref: payload.plan_ref,
      })
    case 'plan.reviewed':
      if (payload.decision === 'APPROVE') {
        return freezeState({
          ...state,
          phase: transition(state.phase, 'PLAN_APPROVED'),
          plan_review_attempts: state.plan_review_attempts + 1,
        })
      }
      if (payload.decision === 'REVISE') {
        return freezeState({
          ...state,
          phase: transition(state.phase, 'PLANNING'),
          plan_ref: null,
          plan_review_attempts: state.plan_review_attempts + 1,
        })
      }
      if (payload.decision === 'REJECT') {
        return freezeState({
          ...state,
          phase: transition(state.phase, 'PLAN_REJECTED'),
          plan_review_attempts: state.plan_review_attempts + 1,
        })
      }
      throw new Error(`unknown plan review decision: ${String(payload.decision)}`)
    case 'work_unit.implementation_submitted':
      return freezeState({ ...state, phase: transition(state.phase, 'VERIFYING') })
    case 'work_unit.verified':
      if (payload.result === 'PASS') {
        return freezeState({
          ...state,
          phase: transition(state.phase, 'DELIVERING', { engineering: 'PASS' }),
          engineering_status: 'PASS',
          learning_status: 'DELIVERING',
        })
      }
      return freezeState({
        ...state,
        phase: transition(state.phase, 'REVISING'),
        engineering_status: 'FAIL',
      })
    case 'work_unit.revision_started':
      return freezeState({ ...state, phase: transition(state.phase, 'BUILDING') })
    case 'implementation.invalidated':
      if (!['DELIVERING', 'AWAITING_GATE'].includes(state.phase)) {
        throw new Error('implementation can only be invalidated after verification')
      }
      return freezeState({
        ...state,
        phase: 'BUILDING',
        engineering_status: 'PENDING',
        learning_status: 'UNTAUGHT',
        deliver_ref: null,
        gate_attempts: 0,
        mastered_targets: [],
        unresolved_targets: [],
        closed: false,
      })
    case 'deliver.completed':
      return freezeState({
        ...state,
        phase: transition(state.phase, 'AWAITING_GATE', { deliver: 'COMPLETE' }),
        learning_status: 'GATE_PENDING',
        deliver_ref: payload.implementation_ref,
      })
    case 'gate.evaluated': {
      if (state.phase !== 'AWAITING_GATE') throw new Error('gate evaluation requires AWAITING_GATE')
      const attempts = state.gate_attempts + 1
      if (payload.result === 'PASS') {
        const mastered = new Set([...state.mastered_targets, ...(payload.mastered_targets ?? [])])
        return freezeState({
          ...state,
          phase: 'CLOSED',
          learning_status: 'MASTERED',
          gate_attempts: attempts,
          mastered_targets: [...mastered].sort(),
          unresolved_targets: [],
          closed: true,
        })
      }
      if (payload.result === 'RETRY') {
        return freezeState({
          ...state,
          phase: transition(state.phase, 'DELIVERING', { learning: 'RETRY' }),
          learning_status: 'DELIVERING',
          gate_attempts: attempts,
          unresolved_targets: [...new Set(payload.gap_codes ?? [])].sort(),
        })
      }
      if (payload.result === 'BLOCK') {
        return freezeState({
          ...state,
          phase: 'CLOSED',
          learning_status: 'BLOCKED',
          gate_attempts: attempts,
          unresolved_targets: [...new Set(payload.gap_codes ?? [])].sort(),
          closed: true,
        })
      }
      throw new Error(`unknown gate result: ${String(payload.result)}`)
    }
    default:
      return state
  }
}

export function replayLearningEvents(taskId, events) {
  return events.reduce(reduceLearningEvent, initialLearningState(taskId))
}
