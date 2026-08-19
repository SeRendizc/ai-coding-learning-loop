import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, getOwnershipController } from '../index-h07.js'

class H07Context {
  constructor(answers = []) {
    this.answers = answers
    this.effects = []
    this.listeners = new Map()
    this.toolDefinitions = new Map()
    this.promptSections = []
    this.command = null
    this.commands = { register: definition => {
      this.command = definition
      return () => { if (this.command === definition) this.command = null }
    } }
    this.userQuestions = { ask: async request => {
      if (this.answers.length === 0) {
        const error = new Error('no provider')
        error.code = 'NO_PROVIDER'
        throw error
      }
      return this.answers.shift()
    } }
    this.skills = { register: () => () => {} }
    this.tools = { register: definition => {
      this.toolDefinitions.set(definition.name, definition)
      return () => this.toolDefinitions.delete(definition.name)
    } }
    this.systemPrompt = { section: definition => {
      this.promptSections.push(definition)
      return () => {}
    } }
  }

  effect(acquire) {
    const cleanup = acquire()
    if (typeof cleanup === 'function') this.effects.push(cleanup)
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return () => {}
  }

  inject(dependencies, callback) {
    if (dependencies.every(dependency => this[dependency])) callback(this)
  }
}

function contractAnswers() {
  return [
    { answers: [{ id: 'learning-target', selected: [], custom: 'understand durable recovery' }] },
    { answers: [
      { id: 'delegation-mode', selected: ['Fully delegated (DELEGATED)'] },
      { id: 'learner-expertise', selected: ['Practitioner (PRACTITIONER)'] },
    ] },
    { answers: [{ id: 'accept-learning-contract', selected: ['Confirm & Generate Plan'] }] },
  ]
}

function harnessSession(id) {
  return {
    id,
    messages: [],
    deriveMessages() { return this.messages },
  }
}

test('H0.7 package entry registers dedicated post-Build tools and hides legacy mega-tool actions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-h07-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new H07Context()
  apply(ctx, { evidenceRoot: root })

  for (const name of [
    'ownership_submit_implementation',
    'ownership_record_verification',
    'ownership_complete_deliver',
    'ownership_open_gate',
    'ownership_record_gate_answer',
    'ownership_evaluate_gate',
  ]) {
    assert.ok(ctx.toolDefinitions.has(name), `${name} must be registered`)
  }

  const lifecycle = ctx.toolDefinitions.get('ownership_lifecycle')
  const actions = lifecycle.parameters.properties.action.enum
  for (const legacy of [
    'submit_implementation',
    'record_verification',
    'complete_deliver',
    'ask_gate',
    'record_gate_answer',
    'evaluate_gate',
  ]) {
    assert.equal(actions.includes(legacy), false, `${legacy} must be hidden from model-facing lifecycle schema`)
  }
  assert.ok(actions.includes('status'))
  assert.ok(actions.includes('start_work'))
  assert.equal(lifecycle.parameters.properties.work_unit_id, undefined)

  const implementation = ctx.toolDefinitions.get('ownership_submit_implementation')
  assert.deepEqual(implementation.parameters.required, ['implementation_ref'])
  assert.equal(implementation.parameters.properties.work_unit_id, undefined)

  const verification = ctx.toolDefinitions.get('ownership_record_verification')
  assert.deepEqual(verification.parameters.required, ['result', 'verification_refs'])
  assert.equal(verification.parameters.properties.implementation_ref, undefined)

  const deliver = ctx.toolDefinitions.get('ownership_complete_deliver')
  assert.equal(deliver.parameters.properties.deliver_record, undefined)

  const gate = ctx.toolDefinitions.get('ownership_open_gate')
  assert.deepEqual(gate.parameters.required, ['items'])
  assert.deepEqual(gate.parameters.properties.items.items.properties.level.enum, ['EXPLAIN', 'PREDICT', 'APPLY'])
  assert.deepEqual(gate.parameters.properties.items.items.properties.deliver_topic.enum, [
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
  ])

  assert.ok(getOwnershipController(ctx))
  assert.ok(ctx.promptSections.some(section => section.name === 'ai-coding-learning-loop:h0-7'))
})

test('brief and start_plan derive active work-unit identity without model-supplied work_unit_id', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-h07-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new H07Context(contractAnswers())
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('runtime-owned-work-unit')
  const exec = { agent: { session }, signal: new AbortController().signal }
  const created = await ctx.command.handler({ rawInput: 'start', ...exec })
  assert.equal(created.kind, 'success')

  const lifecycle = ctx.toolDefinitions.get('ownership_lifecycle')
  const brief = await lifecycle.execute({ action: 'brief', topics: ['durable recovery boundary'] }, exec)
  assert.equal(brief.state.phase, 'BRIEFED')
  assert.equal(brief.state.active_work_unit_id, 'task-main')

  const planning = await lifecycle.execute({ action: 'start_plan' }, exec)
  assert.equal(planning.state.phase, 'PLANNING')
  assert.equal(planning.state.active_work_unit_id, 'task-main')
})

test('H0.7 prompt hardens durable intent, scope, unseen APPLY, and unknown-outcome teaching constraints', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-h07-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new H07Context()
  apply(ctx, { evidenceRoot: root })
  const text = ctx.promptSections.find(section => section.name === 'ai-coding-learning-loop:h0-7')?.text ?? ''
  assert.match(text, /do not send work_unit_id/)
  assert.match(text, /copy\/canonicalize caller-owned mutable arguments/)
  assert.match(text, /generic provider exception\/timeout is UNKNOWN_OUTCOME/)
  assert.match(text, /APPLY must not bind transfer-example/)
  assert.match(text, /materially different scenario/)
  assert.match(text, /new user-visible deliverable, feature, or verification goal requires Plan revision/)
  assert.match(text, /Do not describe this spike as exactly-once delivery/)
  assert.match(text, /PENDING provably means invocation has not started/)
  assert.match(text, /ownership_open_gate/)
})
