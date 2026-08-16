import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, Config, getOwnershipController } from '../index.js'

class CommandContext {
  constructor(answers) {
    this.answers = answers
    this.listeners = new Map()
    this.effects = []
    this.command = null
    this.skill = null
    this.commands = { register: definition => { this.command = definition } }
    this.userQuestions = { ask: async () => this.answers.shift() }
    this.skills = { register: definition => { this.skill = definition } }
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
