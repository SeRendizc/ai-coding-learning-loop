import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canOpenGate,
  requiredGateLevels,
  validateDeliverRecord,
  validateLearningContract,
} from '../src/contracts.mjs'
import { transition } from '../src/lifecycle.mjs'

const contract = {
  schema_version: 'ai-coding-learning-loop.learning-contract.v1',
  task_id: 'tiny-parser',
  mode: 'HUMAN_LED',
  learning_targets: [{ id: 'parser-state', mastery: 'PREDICT', owner: 'human' }],
  work_units: [{ id: 'parse-core', implementation_owner: 'human' }],
  gate: { max_attempts: 3, require_unseen_variant: true },
}

const completeDeliver = {
  schema_version: 'ai-coding-learning-loop.deliver.v1',
  work_unit_id: 'parse-core',
  implementation_ref: 'sha256:implementation',
  verification_refs: ['test:parser'],
  topics_taught: [
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
  ],
  ready_for_gate: true,
}

test('the four delegation modes carry distinct minimum gate evidence', () => {
  assert.deepEqual(requiredGateLevels('GUIDED'), ['EXPLAIN'])
  assert.deepEqual(requiredGateLevels('HUMAN_LED'), ['EXPLAIN', 'PREDICT'])
  assert.deepEqual(requiredGateLevels('AI_LED'), ['EXPLAIN', 'PREDICT', 'APPLY'])
  assert.deepEqual(requiredGateLevels('DELEGATED'), ['EXPLAIN', 'PREDICT', 'APPLY'])
})

test('a valid learning contract is accepted', () => {
  assert.deepEqual(validateLearningContract(contract), [])
})

test('Gate cannot open before the full teaching Deliver exists', () => {
  const incomplete = { ...completeDeliver, topics_taught: ['data-flow'] }
  assert.equal(canOpenGate(incomplete), false)
  assert.match(validateDeliverRecord(incomplete).join('\n'), /missing Deliver topic/)
  assert.throws(
    () => transition('DELIVERING', 'AWAITING_GATE', { deliver: 'INCOMPLETE' }),
    /complete teaching Deliver/,
  )
})

test('verified engineering work may enter Deliver and a complete Deliver may enter Gate', () => {
  assert.equal(transition('VERIFYING', 'DELIVERING', { engineering: 'PASS' }), 'DELIVERING')
  assert.equal(canOpenGate(completeDeliver), true)
  assert.equal(
    transition('DELIVERING', 'AWAITING_GATE', { deliver: 'COMPLETE' }),
    'AWAITING_GATE',
  )
})

test('learning failure returns to Deliver without changing engineering evidence', () => {
  const state = {
    engineering_status: 'PASS',
    learning_status: 'RETRY',
    phase: transition('AWAITING_GATE', 'DELIVERING', { learning: 'RETRY' }),
  }
  assert.deepEqual(state, {
    engineering_status: 'PASS',
    learning_status: 'RETRY',
    phase: 'DELIVERING',
  })
})

test('work cannot close merely because implementation passed', () => {
  assert.throws(
    () => transition('AWAITING_GATE', 'CLOSED', { engineering: 'PASS' }),
    /passing learning evidence/,
  )
})
