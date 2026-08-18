import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, getOwnershipController } from '../index-h07.js'

class H07Context {
  constructor() {
    this.effects = []
    this.listeners = new Map()
    this.toolDefinitions = new Map()
    this.promptSections = []
    this.commands = { register: () => () => {} }
    this.userQuestions = { ask: async () => { const error = new Error('no provider'); error.code = 'NO_PROVIDER'; throw error } }
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

  assert.ok(getOwnershipController(ctx))
  assert.ok(ctx.promptSections.some(section => section.name === 'ai-coding-learning-loop:h0-7'))
})

test('H0.7 prompt hardens durable intent and unknown-outcome teaching constraints', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-h07-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new H07Context()
  apply(ctx, { evidenceRoot: root })
  const text = ctx.promptSections.find(section => section.name === 'ai-coding-learning-loop:h0-7')?.text ?? ''
  assert.match(text, /copy\/canonicalize caller-owned mutable arguments/)
  assert.match(text, /generic provider exception\/timeout is UNKNOWN_OUTCOME/)
  assert.match(text, /ownership_open_gate/)
})
