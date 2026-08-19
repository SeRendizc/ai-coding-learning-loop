import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FileEvidenceLedger } from '../src/evidence.mjs'
import { LearningSession } from '../src/session.mjs'
import { buildLearningReport, renderMarkdownReport } from '../src/report.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'learning-ledger-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let tick = 0
  const ledger = new FileEvidenceLedger(root, {
    now: () => new Date(`2026-08-17T00:00:${String(tick++).padStart(2, '0')}.000Z`),
  })
  return { root, ledger, session: new LearningSession(ledger) }
}

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
  implementation_ref: 'sha256:implementation-a',
  verification_refs: ['test:parser'],
  learning_targets: ['parser-state'],
  topics_taught: [
    'scope', 'reading-order', 'data-flow', 'design-rationale', 'invariants',
    'failure-paths', 'verification', 'prior-knowledge-link', 'transfer-example', 'known-gaps',
  ],
  examples_used: ['extra-close'],
  known_gaps: [],
  ready_for_gate: true,
}

const gate = {
  schema_version: 'ai-coding-learning-loop.gate-case.v1',
  id: 'parser-apply-1',
  level: 'APPLY',
  learning_target_id: 'parser-state',
  deliver_topic: 'failure-paths',
  deliver_ref: 'sha256:implementation-a',
  prompt: 'How should an extra closing delimiter be handled?',
  rubric: ['reject at offending token', 'preserve prior parser state'],
}

const plan = {
  schema_version: 'ai-coding-learning-loop.plan.v1',
  work_unit_id: 'parse-core',
  implementation_steps: ['implement the parser state transition'],
  verification_plan: ['run parser tests'],
  learning_anchors: ['state stack'],
  known_risks: ['unmatched delimiters'],
}

async function reachGate(session) {
  await session.acceptContract(contract)
  await session.brief('tiny-parser', 'parse-core', ['state stack'])
  await session.startPlan('tiny-parser', 'parse-core')
  await session.submitPlan('tiny-parser', plan)
  await session.recordPlanReview('tiny-parser', 'APPROVE')
  await session.startWork('tiny-parser', 'parse-core')
  await session.submitImplementation('tiny-parser', 'parse-core', 'sha256:implementation-a')
  await session.recordVerification('tiny-parser', 'parse-core', 'PASS', 'sha256:implementation-a', ['test:parser'])
  await session.completeDeliver('tiny-parser', deliver)
  await session.askGate('tiny-parser', gate)
}

test('sidecar events survive a new ledger instance and retain a verified hash chain', async t => {
  const { root, ledger } = await fixture(t)
  await ledger.append({ task_id: 'tiny-parser', type: 'contract.accepted', actor: 'user', payload: { mode: 'GUIDED' } })
  await ledger.append({ task_id: 'tiny-parser', type: 'work_unit.briefed', actor: 'agent', payload: { work_unit_id: 'parse' } })

  const recovered = await new FileEvidenceLedger(root).read('tiny-parser')
  assert.equal(recovered.length, 2)
  assert.equal(recovered[1].previous_event_hash, recovered[0].event_hash)
  assert.match(recovered[1].payload_sha256, /^sha256:/)
})

test('tampered payload is rejected instead of becoming recovered truth', async t => {
  const { root, ledger } = await fixture(t)
  await ledger.append({ task_id: 'tiny-parser', type: 'contract.accepted', actor: 'user', payload: { mode: 'GUIDED' } })
  const eventDir = join(root, 'tiny-parser', 'events')
  const [name] = await readdir(eventDir)
  const path = join(eventDir, name)
  const event = JSON.parse(await readFile(path, 'utf8'))
  event.payload.mode = 'DELEGATED'
  await writeFile(path, JSON.stringify(event))
  await assert.rejects(() => ledger.read('tiny-parser'), /payload digest mismatch/)
})

test('snapshot binds derived state to an exact verified event prefix', async t => {
  const { ledger } = await fixture(t)
  await ledger.append({ task_id: 'tiny-parser', type: 'contract.accepted', actor: 'user', payload: { mode: 'GUIDED' } })
  const snapshot = await ledger.writeSnapshot('tiny-parser', { phase: 'CONTRACTED' })
  assert.equal(snapshot.as_of_seq, 0)
  assert.deepEqual((await ledger.readSnapshot('tiny-parser')).state, { phase: 'CONTRACTED' })
})

test('a damaged snapshot falls back to full event replay', async t => {
  const { root, ledger, session } = await fixture(t)
  await session.acceptContract(contract)
  const state = await session.state('tiny-parser')
  await ledger.writeSnapshot('tiny-parser', state)
  const path = join(root, 'tiny-parser', 'snapshot.json')
  const snapshot = JSON.parse(await readFile(path, 'utf8'))
  snapshot.state.phase = 'CLOSED'
  await writeFile(path, JSON.stringify(snapshot))

  const recovered = await new LearningSession(new FileEvidenceLedger(root)).state('tiny-parser')
  assert.equal(recovered.phase, 'CONTRACTED')
  assert.equal(recovered.closed, false)
})

test('Plan REVISE returns to Planning and Build remains blocked until approval', async t => {
  const { session } = await fixture(t)
  await session.acceptContract(contract)
  await session.brief('tiny-parser', 'parse-core', ['state stack'])
  await session.startPlan('tiny-parser', 'parse-core')
  await session.submitPlan('tiny-parser', plan)
  await session.recordPlanReview('tiny-parser', 'REVISE')
  assert.equal((await session.state('tiny-parser')).phase, 'PLANNING')
  await assert.rejects(() => session.startWork('tiny-parser', 'parse-core'), /illegal transition/)
  await session.submitPlan('tiny-parser', { ...plan, known_risks: ['revised boundary'] })
  await session.recordPlanReview('tiny-parser', 'APPROVE')
  assert.equal((await session.state('tiny-parser')).phase, 'PLAN_APPROVED')
  await session.startWork('tiny-parser', 'parse-core')
  assert.equal((await session.state('tiny-parser')).phase, 'BUILDING')
})

test('Gate RETRY survives restart, preserves engineering PASS, and stores no answer text', async t => {
  const { root, session } = await fixture(t)
  await reachGate(session)
  await session.evaluateGate('tiny-parser', 'I would probably ignore it.', {
    result: 'RETRY',
    criterion_results: [
      { criterion: 'reject at offending token', passed: false },
      { criterion: 'preserve prior parser state', passed: false },
    ],
    gap_codes: ['unmatched-close'],
  })

  const restarted = new LearningSession(new FileEvidenceLedger(root))
  const state = await restarted.state('tiny-parser')
  assert.equal(state.engineering_status, 'PASS')
  assert.equal(state.learning_status, 'DELIVERING')
  assert.equal(state.gate_attempts, 1)
  const serialized = JSON.stringify(await restarted.ledger.read('tiny-parser'))
  assert.doesNotMatch(serialized, /I would probably ignore it/)
})

test('max attempts converts RETRY to BLOCK without changing engineering evidence', async t => {
  const { session } = await fixture(t)
  await reachGate(session)
  await session.evaluateGate('tiny-parser', 'first answer', {
    result: 'RETRY', criterion_results: [
      { criterion: 'reject at offending token', passed: false },
      { criterion: 'preserve prior parser state', passed: false },
    ], gap_codes: ['gap'],
  })
  await session.completeDeliver('tiny-parser', deliver)
  await session.askGate('tiny-parser', { ...gate, id: 'parser-apply-2' })
  await session.evaluateGate('tiny-parser', 'second answer', {
    result: 'RETRY', criterion_results: [
      { criterion: 'reject at offending token', passed: false },
      { criterion: 'preserve prior parser state', passed: false },
    ], gap_codes: ['gap'],
  })
  const state = await session.state('tiny-parser')
  assert.equal(state.engineering_status, 'PASS')
  assert.equal(state.learning_status, 'BLOCKED')
  assert.equal(state.gate_attempts, 2)
})

test('a changed implementation invalidates old Deliver and requires verify then Deliver again', async t => {
  const { session } = await fixture(t)
  await reachGate(session)
  await session.invalidateImplementation('tiny-parser', 'sha256:implementation-b')
  let state = await session.state('tiny-parser')
  assert.equal(state.phase, 'BUILDING')
  assert.equal(state.deliver_ref, null)
  assert.equal(state.engineering_status, 'PENDING')

  await session.submitImplementation('tiny-parser', 'parse-core', 'sha256:implementation-b')
  await session.recordVerification('tiny-parser', 'parse-core', 'PASS', 'sha256:implementation-b', ['test:new'])
  await assert.rejects(() => session.completeDeliver('tiny-parser', deliver), /does not match/)
  state = await session.state('tiny-parser')
  assert.equal(state.phase, 'DELIVERING')
})

test('report exposes dual status and labels knowledge debt as missing evidence only', async t => {
  const { ledger, session } = await fixture(t)
  await reachGate(session)
  await session.evaluateGate('tiny-parser', 'valid transfer answer', {
    result: 'PASS',
    criterion_results: [
      { criterion: 'reject at offending token', passed: true },
      { criterion: 'preserve prior parser state', passed: true },
    ],
    mastered_targets: ['parser-state'],
  })
  const report = buildLearningReport('tiny-parser', await ledger.read('tiny-parser'))
  assert.equal(report.engineering_status.verification, 'PASS')
  assert.equal(report.learning_status.phase, 'MASTERED')
  assert.equal(report.metrics.knowledge_debt_items, 0)
  assert.match(renderMarkdownReport(report), /not a cognitive ability score/)
})
