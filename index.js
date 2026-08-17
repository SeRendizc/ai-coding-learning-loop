/**
 * DeepSeek Harness host plugin for AI Coding Learning Loop.
 *
 * Tool hooks remain observation-only. Learning facts use a separate durable
 * sidecar ledger and are exposed through a human-owned command surface.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sha256 } from './src/canonical.mjs'
import { requiredGateLevels } from './src/contracts.mjs'
import { FileEvidenceLedger } from './src/evidence.mjs'
import { buildLearningReport, renderMarkdownReport } from './src/report.mjs'
import { LearningSession } from './src/session.mjs'

export const name = 'ai-coding-learning-loop'
export const inject = ['tools']

const DEFAULT_MAX_ENTRIES = 256
const DEFAULT_EVIDENCE_ROOT = '.ai-coding-learning-loop/evidence'
const BUNDLED_SKILL_PATH = fileURLToPath(new URL('./skills/ai-coding-learning-loop/SKILL.md', import.meta.url))
const probes = new WeakMap()
const controllers = new WeakMap()

/**
 * Cordis resolves plugin configuration through the Standard Schema v1 seam.
 * Keeping this adapter dependency-free also lets the portable core run outside
 * Harness while Harness still validates and applies defaults before `apply`.
 */
export const Config = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: 'ai-coding-learning-loop',
    validate(input) {
      const issues = []
      const value = input ?? {}
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'configuration must be an object' }] }
      }
      const maxEntries = value.maxEntries ?? DEFAULT_MAX_ENTRIES
      const evidenceRoot = value.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT
      if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
        issues.push({ message: 'maxEntries must be a positive safe integer', path: ['maxEntries'] })
      }
      if (typeof evidenceRoot !== 'string' || evidenceRoot.trim().length === 0) {
        issues.push({ message: 'evidenceRoot must be a non-empty path', path: ['evidenceRoot'] })
      }
      if (issues.length > 0) return { issues }
      return { value: { maxEntries, evidenceRoot } }
    },
  }),
})

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

function resolveEvidenceRoot(config) {
  const value = config?.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('ai-coding-learning-loop: evidenceRoot must be a non-empty path')
  }
  return resolve(value)
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

export function getOwnershipController(ctx) {
  return controllers.get(ctx) ?? null
}

function answerValue(answer) {
  return answer?.custom?.trim() || answer?.selected?.[0]
}

function modeOwner(mode) {
  return ['GUIDED', 'HUMAN_LED'].includes(mode) ? 'human' : 'ai'
}

async function startContract(commandCtx, session, invocation) {
  const first = await commandCtx.userQuestions.ask({
    agent: invocation.agent,
    signal: invocation.signal,
    questions: [
      {
        id: 'learning-goal',
        header: 'Goal',
        question: 'What matters most for this coding task?',
        options: [
          { label: 'learn-and-ship', description: 'Balance delivery with transferable understanding.' },
          { label: 'deep-learning', description: 'Keep more implementation responsibility.' },
          { label: 'ship-first', description: 'Delegate implementation but retain teaching gates.' },
        ],
      },
      {
        id: 'delegation-mode',
        header: 'Mode',
        question: 'How much implementation should the AI own?',
        options: [
          { label: 'AI_LED', description: 'AI implements most code; you keep learning anchors.' },
          { label: 'GUIDED', description: 'You implement core code with AI guidance.' },
          { label: 'HUMAN_LED', description: 'AI scaffolds; you implement core methods.' },
          { label: 'DELEGATED', description: 'AI implements all code, then teaches and gates transfer.' },
        ],
      },
      {
        id: 'learning-target',
        header: 'Target',
        question: 'Name the one mechanism you must be able to explain or apply after this task.',
      },
    ],
  })
  const byId = Object.fromEntries(first.answers.map(answer => [answer.id, answer]))
  const goal = answerValue(byId['learning-goal'])
  const mode = answerValue(byId['delegation-mode'])
  const target = answerValue(byId['learning-target'])
  if (!goal || !mode || !target || !['GUIDED', 'HUMAN_LED', 'AI_LED', 'DELEGATED'].includes(mode)) {
    return { kind: 'error', text: 'Learning Contract was not created: goal, valid mode, and target are required.' }
  }
  const taskId = String(invocation.agent.session.id)
  const targetId = `target-${sha256(target).slice(7, 15)}`
  const contract = {
    schema_version: 'ai-coding-learning-loop.learning-contract.v1',
    task_id: taskId,
    goal,
    mode,
    learning_targets: [{
      id: targetId,
      mastery: requiredGateLevels(mode).at(-1),
      owner: 'human',
      description: target,
    }],
    work_units: [{ id: 'task-main', implementation_owner: modeOwner(mode) }],
    gate: { max_attempts: 3, require_unseen_variant: true },
    change_policy: 'explicit-confirmation',
  }
  const confirmation = await commandCtx.userQuestions.ask({
    agent: invocation.agent,
    signal: invocation.signal,
    questions: [{
      id: 'accept-learning-contract',
      header: 'Confirm',
      question: 'Accept this Learning Contract before implementation begins?',
      detail: JSON.stringify(contract, null, 2),
      options: [
        { label: 'Accept', description: 'Persist this contract and begin the learning loop.' },
        { label: 'Cancel', description: 'Persist nothing and stop.' },
      ],
      intent: { kind: 'plan-review', approve: 'Accept' },
    }],
  })
  if (!confirmation.answers[0]?.selected?.includes('Accept')) {
    return { kind: 'error', text: 'Learning Contract cancelled; no learning task was started.' }
  }
  await session.acceptContract(contract)
  return { kind: 'success', text: `Learning Contract accepted for ${taskId} in ${mode} mode.` }
}

function installCommands(ctx, session) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['commands', 'userQuestions'], commandCtx => {
    commandCtx.commands.register({
      name: 'ownership',
      description: 'Start or inspect an AI Coding Learning Loop',
      input: { hint: 'start | status | report' },
      recordInput: false,
      handler: async invocation => {
        const action = invocation.rawInput.trim()
        const taskId = String(invocation.agent.session.id)
        if (action === 'start') return startContract(commandCtx, session, invocation)
        const events = await session.ledger.read(taskId)
        if (events.length === 0) return { kind: 'error', text: 'No Learning Contract exists for this session.' }
        if (action === 'status') return { kind: 'success', text: JSON.stringify(await session.state(taskId), null, 2) }
        if (action === 'report') {
          return { kind: 'success', text: renderMarkdownReport(buildLearningReport(taskId, events)) }
        }
        return { kind: 'error', text: 'Usage: /ownership start | status | report' }
      },
    })
  })
}

export function parseBundledSkill(source) {
  const normalized = source.replace(/\r\n?/gu, '\n')
  const match = /^---\n[\s\S]*?\n---\n\n([\s\S]*)$/u.exec(normalized)
  if (!match) throw new Error('bundled AI Coding Learning Loop Skill is malformed')
  return match[1]
}

function installBundledSkill(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['skills'], skillCtx => {
    const source = readFileSync(BUNDLED_SKILL_PATH, 'utf8')
    skillCtx.skills.register({
      name: 'ai-coding-learning-loop',
      description: 'Preserve transferable understanding while AI plans, implements, verifies, and teaches coding work.',
      content: parseBundledSkill(source),
      source: 'runtime',
      invocation: { modelInvocable: true, userInvocable: true },
      path: BUNDLED_SKILL_PATH,
      resourceBase: { kind: 'directory', path: dirname(BUNDLED_SKILL_PATH) },
    })
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
  const session = new LearningSession(new FileEvidenceLedger(resolveEvidenceRoot(config)))

  ctx.effect(() => {
    probes.set(ctx, state)
    controllers.set(ctx, session)
    return () => {
      probes.delete(ctx)
      controllers.delete(ctx)
    }
  })

  installCommands(ctx, session)
  installBundledSkill(ctx)

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
