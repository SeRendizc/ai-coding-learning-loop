/**
 * DeepSeek Harness host plugin for AI Coding Learning Loop.
 *
 * H0 is deliberately observation-only: it proves that an out-of-tree bundle
 * can join the authoritative tool lifecycle without changing any decision or
 * result. Durable learning evidence is a later work unit.
 */

export const name = 'ai-coding-learning-loop'
export const inject = ['tools']

const DEFAULT_MAX_ENTRIES = 256
const probes = new WeakMap()

function requireContext(ctx) {
  if (!ctx || typeof ctx.on !== 'function' || typeof ctx.effect !== 'function') {
    throw new TypeError('ai-coding-learning-loop requires a Cordis context with on() and effect()')
  }
}

function resolveMaxEntries(config) {
  const value = config?.maxEntries ?? DEFAULT_MAX_ENTRIES
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('ai-coding-learning-loop: maxEntries must be a positive safe integer')
  }
  return value
}

function summarizeExecution(exec) {
  return {
    callId: String(exec.callId),
    toolName: String(exec.name),
    scoped: exec.agent !== undefined,
  }
}

function append(state, entry) {
  state.totalObserved += 1
  state.entries.push(Object.freeze(entry))
  if (state.entries.length > state.maxEntries) state.entries.shift()
}

/**
 * Return an immutable diagnostic view of the observations retained for one
 * mounted plugin context. This is a probe API, not durable learning evidence.
 */
export function getProbeSnapshot(ctx) {
  const state = probes.get(ctx)
  if (!state) {
    return Object.freeze({ active: false, totalObserved: 0, dropped: 0, entries: Object.freeze([]) })
  }
  const entries = Object.freeze([...state.entries])
  return Object.freeze({
    active: true,
    totalObserved: state.totalObserved,
    dropped: state.totalObserved - entries.length,
    entries,
  })
}

/**
 * Mount the observation-only Harness bridge.
 *
 * The pre-execute listener always delegates to `next()` and returns the exact
 * downstream decision. The result listener reads only the immutable final
 * outcome published by Harness.
 */
export function apply(ctx, config = {}) {
  requireContext(ctx)
  if (probes.has(ctx)) {
    throw new Error('ai-coding-learning-loop is already mounted on this context')
  }

  const state = {
    maxEntries: resolveMaxEntries(config),
    totalObserved: 0,
    entries: [],
  }

  ctx.effect(() => {
    probes.set(ctx, state)
    return () => probes.delete(ctx)
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    append(state, Object.freeze({
      phase: 'pre-execute',
      ...summarizeExecution(exec),
    }))
    return next()
  })

  ctx.on('tools/result', (exec, result) => {
    append(state, Object.freeze({
      phase: 'result',
      ...summarizeExecution(exec),
      isError: result.isError === true,
      contentBlocks: Array.isArray(result.content) ? result.content.length : 0,
    }))
  })
}
