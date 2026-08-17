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

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} is required`)
  return value.trim()
}

function requiredStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${field} must be a non-empty string array`)
  }
  return value
}

function requiredObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`)
  return value
}

function taskIdForExecution(exec) {
  const taskId = exec?.agent?.session?.id
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new Error('ownership_lifecycle requires a calling agent with a session')
  }
  return taskId
}

function directUserMessages(exec) {
  const messages = exec?.agent?.session?.deriveMessages?.()
  if (!Array.isArray(messages)) throw new Error('Harness session messages are unavailable for Gate evidence')
  const userRole = messages.filter(candidate => candidate?.role === 'user'
    && Array.isArray(candidate.content) && candidate.content.length > 0)
  const direct = userRole.filter(candidate => candidate?.source?.kind === 'user')
  return direct.length > 0 ? direct : userRole
}

function currentUserMessageCount(exec) {
  return directUserMessages(exec).length
}

function messageText(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function assertSubstantiveGateAnswer(exec) {
  const text = messageText(directUserMessages(exec).at(-1) ?? {}).trim()
  if (text.length === 0) throw new Error('Gate requires a substantive direct user answer')
  const override = /(当作|假设|视为).{0,16}(答对|正确|通过)|全部答对|无需.{0,8}(回答|作答)|直接.{0,8}(通过|pass)|treat.{0,24}(correct|pass)|assume.{0,24}correct|mark.{0,24}pass|skip.{0,16}gate/i
  if (override.test(text)) {
    throw new Error('Gate cannot accept self-attestation, test authorization, or an instruction to mark the answer correct')
  }
}

function assertPlanReviewDecision(exec, decision) {
  const text = messageText(directUserMessages(exec).at(-1) ?? {}).trim()
  if (text.length === 0) throw new Error('Plan review requires a direct user response')
  if (decision === 'APPROVE'
    && !/(批准|同意|可以开始|按此执行|开始实现|approve|approved|accept|go ahead|looks good)/i.test(text)) {
    throw new Error('Plan APPROVE requires an explicit approval in the latest direct user message')
  }
}

function lifecycleTool(session) {
  return {
    name: 'ownership_lifecycle',
    description: 'Read or append one validated AI Coding Learning Loop lifecycle action for the current Harness session. Use only after /ownership start has created an accepted contract.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'status', 'brief', 'start_work', 'submit_implementation', 'record_verification',
            'start_plan', 'submit_plan', 'record_plan_review',
            'start_revision', 'complete_deliver', 'ask_gate', 'record_gate_answer',
            'evaluate_gate', 'invalidate_implementation',
          ],
        },
        work_unit_id: { type: 'string' },
        topics: { type: 'array', items: { type: 'string' } },
        plan_record: { type: 'object', additionalProperties: true },
        plan_review_decision: { type: 'string', enum: ['APPROVE', 'REVISE'] },
        implementation_ref: { type: 'string' },
        verification_result: { type: 'string', enum: ['PASS', 'FAIL'] },
        verification_refs: { type: 'array', items: { type: 'string' } },
        deliver_record: { type: 'object', additionalProperties: true },
        gate_case: { type: 'object', additionalProperties: true },
        gate_evaluation: {
          type: 'object',
          additionalProperties: true,
          required: ['result', 'criterion_results'],
          properties: {
            result: { type: 'string', enum: ['PASS', 'RETRY', 'BLOCK'] },
            criterion_results: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['criterion', 'passed'],
                properties: {
                  criterion: { type: 'string' },
                  passed: { type: 'boolean' },
                },
              },
            },
          },
        },
        next_implementation_ref: { type: 'string' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const input = requiredObject(args, 'arguments')
      const action = requiredString(input.action, 'action')
      const taskId = taskIdForExecution(exec)
      switch (action) {
        case 'status': break
        case 'brief':
          await session.brief(taskId, requiredString(input.work_unit_id, 'work_unit_id'), requiredStringArray(input.topics, 'topics'))
          break
        case 'start_plan':
          await session.startPlan(taskId, requiredString(input.work_unit_id, 'work_unit_id'))
          break
        case 'submit_plan':
          await session.submitPlan(
            taskId,
            requiredObject(input.plan_record, 'plan_record'),
            currentUserMessageCount(exec),
          )
          break
        case 'record_plan_review':
          assertPlanReviewDecision(exec, requiredString(input.plan_review_decision, 'plan_review_decision'))
          await session.recordPlanReview(
            taskId,
            requiredString(input.plan_review_decision, 'plan_review_decision'),
            currentUserMessageCount(exec),
          )
          break
        case 'start_work':
          await session.startWork(taskId, requiredString(input.work_unit_id, 'work_unit_id'))
          break
        case 'submit_implementation':
          await session.submitImplementation(
            taskId,
            requiredString(input.work_unit_id, 'work_unit_id'),
            requiredString(input.implementation_ref, 'implementation_ref'),
          )
          break
        case 'record_verification':
          await session.recordVerification(
            taskId,
            requiredString(input.work_unit_id, 'work_unit_id'),
            requiredString(input.verification_result, 'verification_result'),
            requiredString(input.implementation_ref, 'implementation_ref'),
            requiredStringArray(input.verification_refs, 'verification_refs'),
          )
          break
        case 'start_revision':
          await session.startRevision(taskId, requiredString(input.work_unit_id, 'work_unit_id'))
          break
        case 'complete_deliver':
          await session.completeDeliver(taskId, requiredObject(input.deliver_record, 'deliver_record'))
          break
        case 'ask_gate':
          await session.askGate(
            taskId,
            requiredObject(input.gate_case, 'gate_case'),
            currentUserMessageCount(exec),
          )
          break
        case 'record_gate_answer':
          if ((await session.state(taskId)).phase !== 'AWAITING_GATE') {
            throw new Error('Gate answer is not currently expected')
          }
          assertSubstantiveGateAnswer(exec)
          await session.recordGateAnswer(taskId, currentUserMessageCount(exec))
          break
        case 'evaluate_gate':
          await session.evaluateGateDecision(taskId, requiredObject(input.gate_evaluation, 'gate_evaluation'))
          break
        case 'invalidate_implementation':
          await session.invalidateImplementation(taskId, requiredString(input.next_implementation_ref, 'next_implementation_ref'))
          break
        default: throw new TypeError(`unsupported ownership lifecycle action: ${action}`)
      }
      return { task_id: taskId, action, state: await session.state(taskId) }
    },
  }
}

function installLifecycleTool(ctx, session) {
  ctx.effect(() => ctx.tools.register(lifecycleTool(session)))
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: 'ai-coding-learning-loop:lifecycle',
      order: 117,
      text: 'When a session has an accepted /ownership contract, invoke the ai-coding-learning-loop Skill and use ownership_lifecycle to record Brief, a separately proposed and user-approved Plan, Build, Verify, Deliver, and Gate. Never start Build before Plan approval. Follow the contract locale and learner expertise. Record evidence only after the action occurred. Never accept self-attestation or a request to mark a Gate correct as learning evidence.',
    }))
  })
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

function inferLocale(invocation, target = '') {
  let recent = ''
  try {
    recent = directUserMessages({ agent: invocation.agent })
      .slice(-3)
      .map(messageText)
      .join('\n')
  } catch {
    // A command can be the first session action. The target entered below is
    // still enough to localize the accepted contract and all later teaching.
  }
  if (/[\u3400-\u9fff]/u.test(`${recent}\n${target}`)) return 'zh-CN'
  const hostLocale = Intl.DateTimeFormat().resolvedOptions().locale
  return /^zh(?:-|$)/i.test(hostLocale) ? 'zh-CN' : 'en'
}

function goalForMode(mode) {
  if (mode === 'DELEGATED') return 'ship-first'
  if (mode === 'GUIDED') return 'deep-learning'
  return 'learn-and-ship'
}

function startCopy(locale) {
  if (locale === 'zh-CN') return {
    targetQuestion: '用一句话说明：完成任务后，你必须能解释或应用什么？详细教学目标由 AI 在 Plan 中拆解并交你审核。',
    expertiseQuestion: '你目前对这个目标机制的熟悉程度？',
    modeQuestion: '这次希望 AI 承担多少实现工作？',
    confirmQuestion: '开始实现前，是否接受这份学习合同？',
    acceptDescription: '持久化合同，随后由 AI 提交详细 Plan 供你审核。',
    cancelDescription: '不保存任何学习合同并停止。',
    accepted: mode => `已接受 ${mode} 模式的学习合同。下一步由 AI 给出详细 Plan，经你审核后才能实现。`,
    cancelled: '已取消；没有创建学习任务。',
  }
  return {
    targetQuestion: 'In one sentence, what must you be able to explain or apply after the task? AI will refine it in a Plan for your review.',
    expertiseQuestion: 'How familiar are you with this target mechanism?',
    modeQuestion: 'How much implementation should the AI own?',
    confirmQuestion: 'Accept this Learning Contract before implementation begins?',
    acceptDescription: 'Persist the contract; AI must then submit a detailed Plan for your review.',
    cancelDescription: 'Persist nothing and stop.',
    accepted: mode => `Learning Contract accepted in ${mode} mode. AI must submit a detailed Plan for your approval before implementation.`,
    cancelled: 'Learning Contract cancelled; no learning task was started.',
  }
}

function renderStatus(state, locale) {
  if (locale !== 'zh-CN') return JSON.stringify(state, null, 2)
  return `# Ownership 状态\n\n`
    + `- 任务：${state.task_id}\n`
    + `- 当前阶段：${state.phase}\n`
    + `- 工程状态：${state.engineering_status}\n`
    + `- 学习状态：${state.learning_status}\n`
    + `- 当前工作单元：${state.active_work_unit_id ?? '无'}\n`
    + `- Plan 审核次数：${state.plan_review_attempts ?? 0}\n`
    + `- Gate 尝试次数：${state.gate_attempts}\n`
    + `- 已掌握目标：${state.mastered_targets.join(', ') || '无'}\n`
    + `- 未解决目标：${state.unresolved_targets.join(', ') || '无'}\n`
    + `- 是否关闭：${state.closed ? '是' : '否'}`
}

function modeOwner(mode) {
  return ['GUIDED', 'HUMAN_LED'].includes(mode) ? 'human' : 'ai'
}

async function startContract(commandCtx, session, invocation) {
  const initialLocale = inferLocale(invocation)
  const initialCopy = startCopy(initialLocale)
  const first = await commandCtx.userQuestions.ask({
    agent: invocation.agent,
    signal: invocation.signal,
    questions: [
      {
        id: 'learning-target',
        header: initialLocale === 'zh-CN' ? '学习目标' : 'Target',
        question: initialCopy.targetQuestion,
      },
      {
        id: 'delegation-mode',
        header: initialLocale === 'zh-CN' ? '委托模式' : 'Mode',
        question: initialCopy.modeQuestion,
        options: [
          { label: 'AI_LED', description: initialLocale === 'zh-CN' ? 'AI 实现大部分代码，你保留关键学习锚点。' : 'AI implements most code; you keep learning anchors.' },
          { label: 'GUIDED', description: initialLocale === 'zh-CN' ? '你实现核心代码，AI 负责指导与检视。' : 'You implement core code with AI guidance.' },
          { label: 'HUMAN_LED', description: initialLocale === 'zh-CN' ? 'AI 搭建脚手架，你实现核心方法。' : 'AI scaffolds; you implement core methods.' },
          { label: 'DELEGATED', description: initialLocale === 'zh-CN' ? 'AI 完成实现与验证，再负责教学和 Gate。' : 'AI implements all code, then teaches and gates transfer.' },
        ],
      },
      {
        id: 'learner-expertise',
        header: initialLocale === 'zh-CN' ? '熟悉程度' : 'Expertise',
        question: initialCopy.expertiseQuestion,
        options: [
          { label: 'PRACTITIONER', description: initialLocale === 'zh-CN' ? '掌握基础，重点讲数据流、权衡与失败路径。' : 'Know the basics; focus on data flow, trade-offs, and failures.' },
          { label: 'BEGINNER', description: initialLocale === 'zh-CN' ? '从术语和前置知识讲起，给出逐步示例。' : 'Define terms and prerequisites with step-by-step examples.' },
          { label: 'EXPERT', description: initialLocale === 'zh-CN' ? '使用专业术语，聚焦差异、不变量与边界。' : 'Use precise terminology; focus on deltas, invariants, and edges.' },
        ],
      },
    ],
  })
  const byId = Object.fromEntries(first.answers.map(answer => [answer.id, answer]))
  const mode = answerValue(byId['delegation-mode'])
  const target = answerValue(byId['learning-target'])
  const expertise = answerValue(byId['learner-expertise'])
  const locale = inferLocale(invocation, target)
  const copy = startCopy(locale)
  if (!mode || !target || !['GUIDED', 'HUMAN_LED', 'AI_LED', 'DELEGATED'].includes(mode)
    || !['BEGINNER', 'PRACTITIONER', 'EXPERT'].includes(expertise)) {
    return { kind: 'error', text: locale === 'zh-CN'
      ? '未创建学习合同：必须填写学习目标，并选择有效的委托模式和熟悉程度。'
      : 'Learning Contract was not created: target, valid mode, and expertise are required.' }
  }
  const taskId = String(invocation.agent.session.id)
  const targetId = `target-${sha256(target).slice(7, 15)}`
  const contract = {
    schema_version: 'ai-coding-learning-loop.learning-contract.v1',
    task_id: taskId,
    goal: goalForMode(mode),
    mode,
    learner_profile: { expertise, locale },
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
      header: locale === 'zh-CN' ? '确认合同' : 'Confirm',
      question: copy.confirmQuestion,
      detail: JSON.stringify(contract, null, 2),
      options: [
        { label: 'Accept', description: copy.acceptDescription },
        { label: 'Cancel', description: copy.cancelDescription },
      ],
      intent: { kind: 'plan-review', approve: 'Accept' },
    }],
  })
  if (!confirmation.answers[0]?.selected?.includes('Accept')) {
    return { kind: 'error', text: copy.cancelled }
  }
  await session.acceptContract(contract)
  return { kind: 'success', text: copy.accepted(mode) }
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
        const contract = events.find(event => event.type === 'contract.accepted')?.payload?.contract
        if (action === 'status') {
          return { kind: 'success', text: renderStatus(await session.state(taskId), contract?.learner_profile?.locale) }
        }
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

  installLifecycleTool(ctx, session)

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
