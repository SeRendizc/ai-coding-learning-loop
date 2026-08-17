import test from 'node:test'
import assert from 'node:assert/strict'

import { canonicalize, redactEvidence, sha256 } from '../src/canonical.mjs'
import {
  acceptDeliver,
  acceptLearningContract,
  bindGateCase,
  buildWorkPlan,
  projectTask,
} from '../src/core.mjs'

const contract = {
  schema_version: 'ai-coding-learning-loop.learning-contract.v1',
  task_id: 'tiny-parser',
  mode: 'DELEGATED',
  learning_targets: [{ id: 'parser-state', mastery: 'APPLY', owner: 'human' }],
  work_units: [{ id: 'parse-core', implementation_owner: 'ai' }],
  gate: { max_attempts: 2, require_unseen_variant: true },
  change_policy: 'explicit-confirmation',
}

const deliver = {
  schema_version: 'ai-coding-learning-loop.deliver.v1',
  work_unit_id: 'parse-core',
  implementation_ref: 'sha256:code',
  verification_refs: ['test:parser'],
  learning_targets: ['parser-state'],
  topics_taught: [
    'scope', 'reading-order', 'data-flow', 'design-rationale', 'invariants',
    'failure-paths', 'verification', 'prior-knowledge-link', 'transfer-example', 'known-gaps',
  ],
  examples_used: ['nested-expression'],
  known_gaps: [],
  ready_for_gate: true,
}

test('canonical JSON and digest ignore object key insertion order', () => {
  assert.equal(canonicalize({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}')
  assert.equal(sha256({ a: 1, b: 2 }), sha256({ b: 2, a: 1 }))
  assert.throws(() => canonicalize({ missing: undefined }), /undefined/)
})

test('redaction retains queryable structure but replaces sensitive values with digests', () => {
  const payloadSha256 = sha256('payload')
  const redacted = redactEvidence({ tool: 'write', arguments: { path: 'a', content: 'secret' }, token: 'x', payload_sha256: payloadSha256 })
  assert.equal(redacted.tool, 'write')
  assert.equal(redacted.arguments.path, 'a')
  assert.equal(redacted.arguments.content.redacted, true)
  assert.match(redacted.arguments.content.digest, /^sha256:/)
  assert.equal(redacted.token.redacted, true)
  assert.equal(redacted.payload_sha256, payloadSha256)
})

test('a delegated contract creates an AI-owned plan with all transfer levels', () => {
  assert.equal(acceptLearningContract(contract).task_id, 'tiny-parser')
  assert.deepEqual(buildWorkPlan(contract), [{
    id: 'parse-core',
    implementation_owner: 'ai',
    required_gate_levels: ['EXPLAIN', 'PREDICT', 'APPLY'],
  }])
})

test('Gate binds to the exact implementation and only taught targets and topics', () => {
  const accepted = acceptDeliver(deliver)
  const gate = bindGateCase({
    schema_version: 'ai-coding-learning-loop.gate-case.v1',
    id: 'parser-apply-1',
    level: 'APPLY',
    learning_target_id: 'parser-state',
    deliver_topic: 'failure-paths',
    deliver_ref: 'sha256:code',
    prompt: 'How would you reject an extra closing parenthesis?',
    rubric: ['identifies unmatched closing delimiter', 'fails at the offending token'],
  }, accepted)
  assert.equal(gate.level, 'APPLY')
  assert.throws(() => bindGateCase({ ...gate, deliver_ref: 'sha256:old' }, accepted), /deliver_ref/)
})

test('reducer separates engineering PASS from learning RETRY and preserves attempts', () => {
  const events = [
    { type: 'contract.accepted', payload: {} },
    { type: 'work_unit.briefed', payload: { work_unit_id: 'parse-core' } },
    { type: 'work_unit.started', payload: {} },
    { type: 'work_unit.implementation_submitted', payload: {} },
    { type: 'work_unit.verified', payload: { result: 'PASS' } },
    { type: 'deliver.completed', payload: { implementation_ref: 'sha256:code' } },
    { type: 'gate.evaluated', payload: { result: 'RETRY', gap_codes: ['unmatched-close'] } },
  ]
  assert.deepEqual(projectTask('tiny-parser', events), {
    task_id: 'tiny-parser',
    phase: 'DELIVERING',
    engineering_status: 'PASS',
    learning_status: 'DELIVERING',
    active_work_unit_id: 'parse-core',
    deliver_ref: 'sha256:code',
    gate_attempts: 1,
    mastered_targets: [],
    unresolved_targets: ['unmatched-close'],
    closed: false,
  })
})

test('PASS closes the learning unit while BLOCK closes with unresolved evidence', () => {
  const prefix = [
    { type: 'contract.accepted', payload: {} },
    { type: 'work_unit.briefed', payload: { work_unit_id: 'parse-core' } },
    { type: 'work_unit.started', payload: {} },
    { type: 'work_unit.implementation_submitted', payload: {} },
    { type: 'work_unit.verified', payload: { result: 'PASS' } },
    { type: 'deliver.completed', payload: { implementation_ref: 'sha256:code' } },
  ]
  const passed = projectTask('tiny-parser', [...prefix, {
    type: 'gate.evaluated', payload: { result: 'PASS', mastered_targets: ['parser-state'] },
  }])
  assert.equal(passed.engineering_status, 'PASS')
  assert.equal(passed.learning_status, 'MASTERED')
  assert.equal(passed.closed, true)

  const blocked = projectTask('tiny-parser', [...prefix, {
    type: 'gate.evaluated', payload: { result: 'BLOCK', gap_codes: ['parser-state'] },
  }])
  assert.equal(blocked.engineering_status, 'PASS')
  assert.equal(blocked.learning_status, 'BLOCKED')
})
