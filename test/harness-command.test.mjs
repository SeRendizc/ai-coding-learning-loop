import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, Config, getOwnershipController, parseBundledSkill } from '../index.js'

class CommandContext {
  constructor(answers) {
    this.answers = answers
    this.listeners = new Map()
    this.effects = []
    this.command = null
    this.skill = null
    this.lifecycleTool = null
    this.promptSection = null
    this.commands = { register: definition => { this.command = definition } }
    this.userQuestions = { ask: async () => this.answers.shift() }
    this.skills = { register: definition => { this.skill = definition } }
    this.tools = { register: definition => {
      this.lifecycleTool = definition
      return () => { this.lifecycleTool = null }
    } }
    this.systemPrompt = { section: definition => {
      this.promptSection = definition
      return () => { this.promptSection = null }
    } }
  }

  effect(acquire) { this.effects.push(acquire()) }

  on(event, listener) {
    this.listeners.set(event, listener)
    const dispose = () => this.listeners.delete(event)
    this.effects.push(dispose)
    return dispose
  }

  inject(dependencies, callback) {
    if (dependencies.every(dependency => this[dependency])) callback(this)
  }
}

test('bundled Skill parser accepts Windows CRLF line endings', () => {
  const source = '---\r\nname: demo\r\ndescription: demo\r\n---\r\n\r\n# Body\r\n'
  assert.equal(parseBundledSkill(source), '# Body\n')
})

test('Harness bundle registers the learning Skill with its resource directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([])
  apply(ctx, { evidenceRoot: root })
  assert.equal(ctx.skill.name, 'ai-coding-learning-loop')
  assert.equal(ctx.skill.source, 'runtime')
  assert.deepEqual(ctx.skill.invocation, { modelInvocable: true, userInvocable: true })
  assert.match(ctx.skill.content, /Deliver completely/)
  assert.match(ctx.skill.resourceBase.path, /skills[/\\]ai-coding-learning-loop$/)
  assert.equal(ctx.lifecycleTool.name, 'ownership_lifecycle')
  assert.match(ctx.promptSection.text, /durably record each completed Brief/)
})

test('Cordis configuration seam applies defaults and rejects invalid values', () => {
  assert.deepEqual(Config['~standard'].validate(undefined), {
    value: { maxEntries: 256, evidenceRoot: '.ai-coding-learning-loop/evidence' },
  })
  assert.deepEqual(Config['~standard'].validate({ maxEntries: 8, evidenceRoot: 'proof' }), {
    value: { maxEntries: 8, evidenceRoot: 'proof' },
  })
  const invalid = Config['~standard'].validate({ maxEntries: 0, evidenceRoot: '' })
  assert.equal(invalid.issues.length, 2)
  assert.deepEqual(invalid.issues.map(issue => issue.path), [['maxEntries'], ['evidenceRoot']])
})

test('/ownership start asks, confirms, and durably creates one contract', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([
    { answers: [
      { id: 'learning-goal', selected: ['learn-and-ship'] },
      { id: 'delegation-mode', selected: ['DELEGATED'] },
      { id: 'learning-target', selected: [], custom: 'event replay' },
    ] },
    { answers: [{ id: 'accept-learning-contract', selected: ['Accept'] }] },
  ])
  apply(ctx, { evidenceRoot: root })

  const result = await ctx.command.handler({
    rawInput: ' start',
    agent: { session: { id: 'session-1' } },
    signal: new AbortController().signal,
  })

  assert.equal(result.kind, 'success')
  const events = await getOwnershipController(ctx).ledger.read('session-1')
  assert.equal(events.length, 1)
  assert.equal(events[0].payload.contract.mode, 'DELEGATED')
  assert.equal(events[0].payload.contract.learning_targets[0].mastery, 'APPLY')
})

test('/ownership start persists nothing when confirmation is cancelled', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([
    { answers: [
      { id: 'learning-goal', selected: ['deep-learning'] },
      { id: 'delegation-mode', selected: ['GUIDED'] },
      { id: 'learning-target', selected: [], custom: 'parser state' },
    ] },
    { answers: [{ id: 'accept-learning-contract', selected: ['Cancel'] }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const result = await ctx.command.handler({
    rawInput: 'start', agent: { session: { id: 'session-2' } }, signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'error')
  assert.deepEqual(await getOwnershipController(ctx).ledger.read('session-2'), [])
})

test('/ownership status is a human command and never becomes a model tool', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([])
  apply(ctx, { evidenceRoot: root })
  assert.equal(ctx.command.name, 'ownership')
  assert.equal(ctx.command.recordInput, false)
  const result = await ctx.command.handler({
    rawInput: 'status', agent: { session: { id: 'missing' } }, signal: new AbortController().signal,
  })
  assert.deepEqual(result, { kind: 'error', text: 'No Learning Contract exists for this session.' })
})

test('model lifecycle tool durably completes one real Deliver and Gate loop', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([
    { answers: [
      { id: 'learning-goal', selected: ['ship-first'] },
      { id: 'delegation-mode', selected: ['DELEGATED'] },
      { id: 'learning-target', selected: [], custom: 'event replay' },
    ] },
    { answers: [{ id: 'accept-learning-contract', selected: ['Accept'] }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const harnessSession = {
    id: 'session-lifecycle',
    messages: [],
    deriveMessages() { return this.messages },
  }
  const exec = { agent: { session: harnessSession }, signal: new AbortController().signal }
  await ctx.command.handler({ rawInput: 'start', ...exec })
  const call = args => ctx.lifecycleTool.execute(args, exec)
  const events = await getOwnershipController(ctx).ledger.read('session-lifecycle')
  const targetId = events[0].payload.contract.learning_targets[0].id
  const implementationRef = 'sha256:implementation-lifecycle'

  assert.equal((await call({ action: 'status' })).state.phase, 'CONTRACTED')
  await call({ action: 'brief', work_unit_id: 'task-main', topics: ['runtime boundary'] })
  await call({ action: 'start_work', work_unit_id: 'task-main' })
  await call({ action: 'submit_implementation', work_unit_id: 'task-main', implementation_ref: implementationRef })
  await call({
    action: 'record_verification',
    work_unit_id: 'task-main',
    verification_result: 'PASS',
    implementation_ref: implementationRef,
    verification_refs: ['test:unit'],
  })
  await call({ action: 'complete_deliver', deliver_record: {
    schema_version: 'ai-coding-learning-loop.deliver.v1',
    work_unit_id: 'task-main',
    implementation_ref: implementationRef,
    verification_refs: ['test:unit'],
    learning_targets: [targetId],
    topics_taught: [
      'scope', 'reading-order', 'data-flow', 'design-rationale', 'invariants',
      'failure-paths', 'verification', 'prior-knowledge-link', 'transfer-example', 'known-gaps',
    ],
    known_gaps: [],
    ready_for_gate: true,
  } })
  await call({ action: 'ask_gate', gate_case: {
    schema_version: 'ai-coding-learning-loop.gate-case.v1',
    id: 'gate-apply-1',
    level: 'APPLY',
    learning_target_id: targetId,
    deliver_topic: 'failure-paths',
    deliver_ref: implementationRef,
    prompt: 'Apply the recovery rule to a changed event.',
    rubric: ['uses verified events', 'rejects a mismatched digest'],
  } })
  harnessSession.messages = [{ role: 'user', content: [{ type: 'text', text: 'Use the verified prefix and reject the bad digest.' }] }]
  await call({ action: 'record_gate_answer' })
  const answerEvents = await getOwnershipController(ctx).ledger.read('session-lifecycle')
  assert.equal(JSON.stringify(answerEvents).includes('Use the verified prefix'), false)
  const result = await call({ action: 'evaluate_gate', gate_evaluation: {
    result: 'PASS',
    criterion_results: [
      { criterion: 'uses verified events', passed: true },
      { criterion: 'rejects a mismatched digest', passed: true },
    ],
    mastered_targets: [targetId],
  } })
  assert.equal(result.state.phase, 'CLOSED')
  assert.equal(result.state.engineering_status, 'PASS')
  assert.equal(result.state.learning_status, 'MASTERED')
})

test('model lifecycle tool fails closed without current evidence and preserves the log', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([])
  apply(ctx, { evidenceRoot: root })
  const exec = {
    agent: { session: { id: 'missing-contract', deriveMessages: () => [] } },
    signal: new AbortController().signal,
  }
  await assert.rejects(
    () => ctx.lifecycleTool.execute({ action: 'brief', work_unit_id: 'task-main', topics: ['x'] }, exec),
    /no accepted Learning Contract/,
  )
  assert.deepEqual(await getOwnershipController(ctx).ledger.read('missing-contract'), [])
  await assert.rejects(() => ctx.lifecycleTool.execute({ action: 'record_gate_answer' }, exec), /not currently expected/)
})
