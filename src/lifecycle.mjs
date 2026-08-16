const ALLOWED = Object.freeze({
  DISCOVER: new Set(['CONTRACTED']),
  CONTRACTED: new Set(['BRIEFED']),
  BRIEFED: new Set(['BUILDING']),
  BUILDING: new Set(['VERIFYING']),
  VERIFYING: new Set(['DELIVERING', 'REVISING']),
  DELIVERING: new Set(['AWAITING_GATE']),
  AWAITING_GATE: new Set(['CLOSED', 'DELIVERING']),
  REVISING: new Set(['BUILDING', 'DELIVERING']),
  CLOSED: new Set(),
})

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
