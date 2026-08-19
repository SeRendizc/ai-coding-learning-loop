import test from 'node:test'
import assert from 'node:assert/strict'

import {
  materializeCompositeGate,
  materializeCompositeGateEvaluation,
  materializeDeliverRecord,
} from '../src/h0-delivery-gate.mjs'

const deliver = {
  schema_version: 'ai-coding-learning-loop.deliver.v1',
  work_unit_id: 'task-main',
  implementation_ref: 'sha256:impl',
  verification_refs: ['test:unit'],
  learning_targets: ['target-agent-infra'],
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
  known_gaps: [],
  ready_for_gate: true,
}

const context = {
  contract: {
    mode: 'DELEGATED',
    learning_targets: [{ id: 'target-agent-infra' }],
    gate: { require_unseen_variant: true },
  },
  state: {
    phase: 'DELIVERING',
    active_work_unit_id: 'task-main',
  },
}

const events = [{
  type: 'work_unit.verified',
  payload: {
    result: 'PASS',
    implementation_ref: 'sha256:impl',
    verification_refs: ['test:unit'],
  },
}]

function validItems() {
  return [
    {
      id: 'explain',
      level: 'EXPLAIN',
      deliver_topic: 'data-flow',
      prompt: 'Explain why intent is durable before invocation.',
      rubric: ['identifies the durable source of truth'],
    },
    {
      id: 'predict',
      level: 'PREDICT',
      deliver_topic: 'invariants',
      prompt: 'Predict exact and conflicting duplicate behavior.',
      rubric: ['predicts exact duplicate coalescing'],
    },
    {
      id: 'apply',
      level: 'APPLY',
      deliver_topic: 'failure-paths',
      prompt: 'Apply unknown-outcome recovery to a different side-effectful provider.',
      rubric: ['blocks blind rerun after unknown outcome'],
    },
  ]
}

test('dedicated Deliver materializer derives Runtime-owned evidence fields', () => {
  const record = materializeDeliverRecord(context, events, { known_gaps: ['lookup-failure'] })
  assert.equal(record.schema_version, 'ai-coding-learning-loop.deliver.v1')
  assert.equal(record.work_unit_id, 'task-main')
  assert.equal(record.implementation_ref, 'sha256:impl')
  assert.deepEqual(record.verification_refs, ['test:unit'])
  assert.deepEqual(record.learning_targets, ['target-agent-infra'])
  assert.equal(record.ready_for_gate, true)
  assert.ok(record.topics_taught.includes('failure-paths'))
  assert.deepEqual(record.known_gaps, ['lookup-failure'])
})

test('DELEGATED composite Gate rejects missing required APPLY coverage', () => {
  const items = validItems().filter(item => item.level !== 'APPLY')
  assert.throws(
    () => materializeCompositeGate(context, deliver, { items }),
    /missing required levels: APPLY/,
  )
})

test('unseen APPLY cannot reuse the taught transfer-example binding', () => {
  const items = validItems()
  items[2] = { ...items[2], deliver_topic: 'transfer-example' }
  assert.throws(
    () => materializeCompositeGate(context, deliver, { items }),
    /APPLY unseen variant cannot reuse the taught transfer-example/,
  )
})

test('transfer-example binding remains legal when unseen variants are not required', () => {
  const items = validItems()
  items[2] = { ...items[2], deliver_topic: 'transfer-example' }
  const relaxed = {
    ...context,
    contract: { ...context.contract, gate: { require_unseen_variant: false } },
  }
  const gate = materializeCompositeGate(relaxed, deliver, { items })
  assert.equal(gate.require_unseen_variant, false)
  assert.equal(gate.items[2].deliver_topic, 'transfer-example')
})

test('composite Gate binds exactly EXPLAIN PREDICT APPLY and flattens rubric evidence', () => {
  const gate = materializeCompositeGate(context, deliver, { items: validItems() })
  assert.deepEqual(gate.required_levels, ['EXPLAIN', 'PREDICT', 'APPLY'])
  assert.equal(gate.require_unseen_variant, true)
  assert.deepEqual(gate.items.map(item => item.level), ['EXPLAIN', 'PREDICT', 'APPLY'])
  assert.deepEqual(gate.rubric, [
    'explain::identifies the durable source of truth',
    'predict::predicts exact duplicate coalescing',
    'apply::blocks blind rerun after unknown outcome',
  ])
})

test('composite Gate PASS requires every asked item and criterion', () => {
  const gate = materializeCompositeGate(context, deliver, { items: validItems() })
  assert.throws(
    () => materializeCompositeGateEvaluation({
      result: 'PASS',
      item_results: [
        {
          item_id: 'explain',
          level: 'EXPLAIN',
          criterion_results: [{ criterion: 'identifies the durable source of truth', passed: true }],
        },
        {
          item_id: 'predict',
          level: 'PREDICT',
          criterion_results: [{ criterion: 'predicts exact duplicate coalescing', passed: true }],
        },
      ],
    }, gate),
    /cover every Gate item exactly once/,
  )
})

test('composite Gate PASS materializes mastered target only after all criteria pass', () => {
  const gate = materializeCompositeGate(context, deliver, { items: validItems() })
  const evaluation = materializeCompositeGateEvaluation({
    result: 'PASS',
    item_results: [
      {
        item_id: 'explain',
        level: 'EXPLAIN',
        criterion_results: [{ criterion: 'identifies the durable source of truth', passed: true }],
      },
      {
        item_id: 'predict',
        level: 'PREDICT',
        criterion_results: [{ criterion: 'predicts exact duplicate coalescing', passed: true }],
      },
      {
        item_id: 'apply',
        level: 'APPLY',
        criterion_results: [{ criterion: 'blocks blind rerun after unknown outcome', passed: true }],
      },
    ],
  }, gate)
  assert.deepEqual(evaluation.mastered_targets, ['target-agent-infra'])
  assert.deepEqual(evaluation.criterion_results, [
    { criterion: 'explain::identifies the durable source of truth', passed: true },
    { criterion: 'predict::predicts exact duplicate coalescing', passed: true },
    { criterion: 'apply::blocks blind rerun after unknown outcome', passed: true },
  ])
})

test('composite Gate cannot PASS when one criterion fails', () => {
  const gate = materializeCompositeGate(context, deliver, { items: validItems() })
  assert.throws(
    () => materializeCompositeGateEvaluation({
      result: 'PASS',
      item_results: [
        {
          item_id: 'explain',
          level: 'EXPLAIN',
          criterion_results: [{ criterion: 'identifies the durable source of truth', passed: true }],
        },
        {
          item_id: 'predict',
          level: 'PREDICT',
          criterion_results: [{ criterion: 'predicts exact duplicate coalescing', passed: false }],
        },
        {
          item_id: 'apply',
          level: 'APPLY',
          criterion_results: [{ criterion: 'blocks blind rerun after unknown outcome', passed: true }],
        },
      ],
    }, gate),
    /PASS requires every item criterion to pass/,
  )
})
