import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { apply, getProbeSnapshot, inject, name } from '../index.js'

class ContractContext {
  #effects = []
  #listeners = new Map()

  constructor() {
    this.registeredTools = new Map()
    this.tools = { register: definition => {
      this.registeredTools.set(definition.name, definition)
      return () => this.registeredTools.delete(definition.name)
    } }
  }

  effect(acquire) {
    this.#effects.push(acquire())
  }

  on(event, listener) {
    const listeners = this.#listeners.get(event) ?? []
    listeners.push(listener)
    this.#listeners.set(event, listeners)
    const dispose = () => {
      const index = listeners.indexOf(listener)
      if (index === -1) return false
      listeners.splice(index, 1)
      return true
    }
    this.#effects.push(dispose)
    return dispose
  }

  async waterfall(event, exec, terminal) {
    const listeners = this.#listeners.get(event) ?? []
    const call = (index) => index === listeners.length
      ? terminal()
      : listeners[index](exec, () => call(index + 1))
    return call(0)
  }

  emit(event, ...args) {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args)
  }

  listenerCount(event) {
    return (this.#listeners.get(event) ?? []).length
  }

  dispose() {
    for (const dispose of this.#effects.reverse()) dispose?.()
    this.#effects = []
  }
}

const execution = Object.freeze({
  callId: 'call-7',
  name: 'write',
  arguments: Object.freeze({ path: 'notes.txt' }),
  agent: Object.freeze({ id: 'agent-1' }),
})

test('exports the loader metadata required by the Harness bundle', () => {
  assert.equal(name, 'ai-coding-learning-loop')
  assert.deepEqual(inject, ['tools'])
})

test('observes pre-execute while preserving the exact downstream decision', async () => {
  const ctx = new ContractContext()
  apply(ctx)
  assert.ok(ctx.registeredTools.has('ownership_lifecycle'))
  const downstream = Object.freeze({ kind: 'deny', reason: 'policy denied this call' })
  let downstreamCalls = 0

  const actual = await ctx.waterfall('tools/pre-execute', execution, async () => {
    downstreamCalls += 1
    return downstream
  })

  assert.equal(actual, downstream)
  assert.equal(downstreamCalls, 1)
  assert.deepEqual(getProbeSnapshot(ctx).entries, [{
    phase: 'pre-execute',
    callId: 'call-7',
    toolName: 'write',
    scoped: true,
  }])
})

test('observes immutable final results without retaining arguments or content', () => {
  const ctx = new ContractContext()
  apply(ctx)
  const result = Object.freeze({
    isError: false,
    content: Object.freeze([{ type: 'text', text: 'secret output' }]),
  })

  ctx.emit('tools/result', execution, result)

  assert.deepEqual(getProbeSnapshot(ctx).entries, [{
    phase: 'result',
    callId: 'call-7',
    toolName: 'write',
    scoped: true,
    isError: false,
    contentBlocks: 1,
  }])
  assert.equal('arguments' in getProbeSnapshot(ctx).entries[0], false)
  assert.equal('content' in getProbeSnapshot(ctx).entries[0], false)
})

test('bounds the in-memory probe and reports dropped observations', async () => {
  const ctx = new ContractContext()
  apply(ctx, { maxEntries: 2 })

  await ctx.waterfall('tools/pre-execute', execution, async () => ({ kind: 'allow' }))
  ctx.emit('tools/result', execution, { isError: false, content: [] })
  ctx.emit('tools/result', { ...execution, callId: 'call-8' }, { isError: true, content: [] })

  const snapshot = getProbeSnapshot(ctx)
  assert.equal(snapshot.totalObserved, 3)
  assert.equal(snapshot.dropped, 1)
  assert.deepEqual(snapshot.entries.map(entry => entry.phase), ['result', 'result'])
})

test('unload removes listeners and clears the probe state', () => {
  const ctx = new ContractContext()
  apply(ctx)
  assert.equal(ctx.listenerCount('tools/pre-execute'), 1)
  assert.equal(ctx.listenerCount('tools/result'), 1)

  ctx.dispose()

  assert.equal(ctx.listenerCount('tools/pre-execute'), 0)
  assert.equal(ctx.listenerCount('tools/result'), 0)
  assert.equal(ctx.registeredTools.has('ownership_lifecycle'), false)
  assert.deepEqual(getProbeSnapshot(ctx), {
    active: false,
    totalObserved: 0,
    dropped: 0,
    entries: [],
  })
})

test('invalid configuration and duplicate mounts fail loudly', () => {
  assert.throws(() => apply(new ContractContext(), { maxEntries: 0 }), /positive safe integer/)
  const ctx = new ContractContext()
  apply(ctx)
  assert.throws(() => apply(ctx), /already mounted/)
})

test('the package declares a Harness bundle that mounts this package', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  assert.equal(manifest.name, 'dsh-ai-coding-learning-loop')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(patch, /id: ai-coding-learning-loop/)
  assert.match(patch, /name: dsh-ai-coding-learning-loop/)
})
