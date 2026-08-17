/**
 * DeepSeek Harness host plugin for AI Coding Learning Loop.
 *
 * Learning facts use a durable sidecar ledger. Human commands own contract
 * intake, the model-facing lifecycle tool owns validated transitions, and a
 * pre-execute policy blocks side-effectful host tools outside implementation
 * phases once an Ownership contract exists.
 */

import { randomUUID } from 'node:crypto'
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
const IMPLEMENTATION_PHASES = new Set(['BUILDING', 'VERIFYING', 'REVISING'])
const MODE_CODES = ['GUIDED', 'HUMAN_LED', 'AI_LED', 'DELEGATED']
const EXPERTISE_CODES = ['BEGINNER', 'PRACTITIONER', 'EXPERT']

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
  if (!Array.isArray(messages)) throw new Error('Harness session messages are unavailable for user evidence')
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

function answerValue(answer) {
  return answer?.custom?.trim() || answer?.selected?.[0]
}

function enumAnswer(answer, values) {
  const raw = answerValue(answer)
  if (!raw) return undefined
  return values.find(value => raw === value || raw.includes(`(${value})`))
}

function inferLocale(invocation, text = '') {
  let recent = ''
  try {
    recent = directUserMessages({ agent: invocation.agent })
      .slice(-3)
      .map(messageText)
      .join('\n')
  } catch {
    // Commands may be the first session action; explicit form text is enough.
  }
  if (/[\u3400-\u9fff]/u.test(`${recent}\n${text}`)) return 'zh-CN'
  const hostLocale = Intl.DateTimeFormat().resolvedOptions().locale
  return /^zh(?:-|$)/i.test(hostLocale) ? 'zh-CN' : 'en'
}

function inferExistingCodingTask(invocation) {
  try {
    return directUserMessages({ agent: invocation.agent })
      .map(messageText)
      .map(text => text.trim())
      .filter(text => text.length > 0 && !text.startsWith('/'))
      .at(-1) ?? ''
  } catch {
    return ''
  }
}

function goalForMode(mode) {
  if (mode === 'DELEGATED') return 'ship-first'
  if (mode === 'GUIDED') return 'deep-learning'
  return 'learn-and-ship'
}

function modeOwner(mode) {
  return ['GUIDED', 'HUMAN_LED'].includes(mode) ? 'human' : 'ai'
}

function modeUi(locale) {
  if (locale === 'zh-CN') return {
    GUIDED: {
      label: '用户实现（GUIDED）',
      description: 'AI 负责分析、规划、教学、审查和测试建议；核心设计与实现由你完成。',
    },
    HUMAN_LED: {
      label: '用户主导核心（HUMAN_LED）',
      description: 'AI 搭脚手架、接口、机械代码和测试草稿；核心方法和数据流由你完成。',
    },
    AI_LED: {
      label: 'AI 主导实现（AI_LED）',
      description: 'AI 负责大部分架构、代码、测试和修复；你负责预测、审查，并亲自修改至少一个关键学习锚点。',
    },
    DELEGATED: {
      label: 'AI 全权实现（DELEGATED）',
      description: 'AI 完成全部实现与验证，再负责教学；你负责理解、迁移和 Gate。',
    },
  }
  return {
    GUIDED: { label: 'You implement (GUIDED)', description: 'AI analyzes, plans, teaches, reviews, and suggests tests; you own core design and implementation.' },
    HUMAN_LED: { label: 'You lead the core (HUMAN_LED)', description: 'AI scaffolds interfaces, mechanical code, and test drafts; you implement core methods and data flow.' },
    AI_LED: { label: 'AI-led implementation (AI_LED)', description: 'AI owns most architecture, code, tests, and fixes; you predict, review, and modify at least one learning anchor.' },
    DELEGATED: { label: 'Fully delegated (DELEGATED)', description: 'AI implements and verifies everything, then teaches; you own transfer and the Gate.' },
  }
}

function expertiseUi(locale) {
  if (locale === 'zh-CN') return {
    BEGINNER: { label: '入门（BEGINNER）', description: '从术语和前置知识讲起，给出逐步示例。' },
    PRACTITIONER: { label: '熟练（PRACTITIONER）', description: '默认掌握基础，重点讲数据流、权衡和失败路径。' },
    EXPERT: { label: '专家（EXPERT）', description: '使用专业术语，聚焦差异、不变量、边界和替代方案。' },
  }
  return {
    BEGINNER: { label: 'Beginner (BEGINNER)', description: 'Define terms and prerequisites with step-by-step examples.' },
    PRACTITIONER: { label: 'Practitioner (PRACTITIONER)', description: 'Assume foundations; focus on data flow, trade-offs, and failure paths.' },
    EXPERT: { label: 'Expert (EXPERT)', description: 'Use precise terminology; focus on deltas, invariants, edges, and alternatives.' },
  }
}

function startCopy(locale) {
  if (locale === 'zh-CN') return {
    taskQuestion: '这次要让 AI Coding 帮你完成什么编码任务？一句话就行。',
    targetQuestion: '这次你最想通过 AI Coding 学会什么？一句话告诉我就行，具体学习点会在 Plan 里拆好给你审核。',
    expertiseQuestion: '你目前对这个目标有多熟？',
    modeQuestion: '这次你希望怎么分工？从你全实现到 AI 全实现都可以。',
    confirmQuestion: '确认这次的任务、学习目标和分工方式吗？接受后 AI 会自动生成 Plan，Plan 仍需你单独批准。',
    acceptLabel: '接受学习合同',
    cancelLabel: '返回修改',
    acceptDescription: '保存学习合同并自动进入 Brief 与 Plan；不会直接开始写代码。',
    cancelDescription: '不保存合同，返回后重新填写。',
    accepted: queued => queued ? '学习合同已接受，正在生成 Plan；Plan 会单独弹出给你审核，批准前不会开始实现。' : '学习合同已接受。请发送“继续”生成 Plan；批准 Plan 前不会开始实现。',
    cancelled: '未创建学习合同；你可以重新运行 /ownership start。',
  }
  return {
    taskQuestion: 'What coding task should AI Coding help complete? One sentence is enough.',
    targetQuestion: 'What do you most want to learn from this AI Coding task? One sentence is enough; AI will refine the learning anchors in the Plan for your review.',
    expertiseQuestion: 'How familiar are you with this target?',
    modeQuestion: 'How should implementation responsibility be split, from fully human to fully AI?',
    confirmQuestion: 'Confirm this task, learning target, and responsibility split? After acceptance AI will generate a separate Plan that still requires your approval.',
    acceptLabel: 'Accept Learning Contract',
    cancelLabel: 'Revise inputs',
    acceptDescription: 'Persist the contract and automatically move to Brief and Plan; no implementation starts yet.',
    cancelDescription: 'Persist nothing and return to edit the inputs.',
    accepted: queued => queued ? 'Learning Contract accepted. AI is generating the Plan; implementation remains blocked until you approve that Plan.' : 'Learning Contract accepted. Send “continue” to generate the Plan; implementation remains blocked until approval.',
    cancelled: 'Learning Contract was not created; run /ownership start again when ready.',
  }
}

function renderContractSummary(contract) {
  const locale = contract.learner_profile?.locale
  const mode = modeUi(locale)[contract.mode]
  const expertise = expertiseUi(locale)[contract.learner_profile?.expertise]
  const target = contract.learning_targets[0]?.description ?? ''
  if (locale === 'zh-CN') {
    return `## 学习合同\n\n`
      + `- **编码任务**：${contract.engineering_task}\n`
      + `- **学习目标**：${target}\n`
      + `- **分工方式**：${mode.label}\n`
      + `  - ${mode.description}\n`
      + `- **当前熟悉程度**：${expertise?.label ?? contract.learner_profile?.expertise}\n`
      + `- **理解验证**：最多 ${contract.gate.max_attempts} 次；需要新的迁移题，不以“测试通过”代替你真正理解。\n\n`
      + `接受这份合同只确认任务、学习目标和分工，**不等于批准代码执行**。后续 Plan 会单独审核。`
  }
  return `## Learning Contract\n\n`
    + `- **Coding task**: ${contract.engineering_task}\n`
    + `- **Learning target**: ${target}\n`
    + `- **Responsibility split**: ${mode.label}\n`
    + `  - ${mode.description}\n`
    + `- **Current expertise**: ${expertise?.label ?? contract.learner_profile?.expertise}\n`
    + `- **Transfer Gate**: at most ${contract.gate.max_attempts} attempts with an unseen variant.\n\n`
    + `Accepting this contract does **not** approve implementation. The Plan is reviewed separately.`
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

function renderPlan(plan, locale) {
  const section = (title, items) => `### ${title}\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n') || '- 无'}\n`
  if (locale === 'zh-CN') {
    return `## 实现方案\n\n`
      + section('实现步骤', plan.implementation_steps)
      + `\n${section('验证方案', plan.verification_plan)}`
      + `\n${section('学习锚点', plan.learning_anchors)}`
      + `\n${section('已知风险', plan.known_risks)}`
  }
  return `## Implementation Plan\n\n`
    + section('Implementation steps', plan.implementation_steps)
    + `\n${section('Verification', plan.verification_plan)}`
    + `\n${section('Learning anchors', plan.learning_anchors)}`
    + `\n${section('Known risks', plan.known_risks)}`
}

function planReviewCopy(locale) {
  if (locale === 'zh-CN') return {
    header: '方案审核',
    question: '请审核这份 Plan。只有批准后 AI 才能进入实现；需要改动时可以直接选择“要求修改”并补充你的意见。',
    approve: '批准方案',
    revise: '要求修改',
    approveDescription: '批准当前 Plan，允许随后进入 Build。',
    reviseDescription: '退回 Planning；AI 必须修改并重新提交 Plan。',
  }
  return {
    header: 'Plan review',
    question: 'Review this Plan. Implementation remains blocked until approval; choose revision and add feedback if anything should change.',
    approve: 'Approve Plan',
    revise: 'Request revision',
    approveDescription: 'Approve this Plan and allow the later Build phase.',
    reviseDescription: 'Return to Planning; AI must revise and resubmit.',
  }
}

async function requestNativePlanReview(userQuestions, exec, plan, locale) {
  if (!userQuestions || typeof userQuestions.ask !== 'function' || !exec?.agent) return null
  const copy = planReviewCopy(locale)
  try {
    const response = await userQuestions.ask({
      agent: exec.agent,
      signal: exec.signal,
      questions: [{
        id: 'ownership-plan-review',
        header: copy.header,
        question: copy.question,
        detail: renderPlan(plan, locale),
        options: [
          { label: copy.approve, description: copy.approveDescription },
          { label: copy.revise, description: copy.reviseDescription },
        ],
        intent: { kind: 'plan-review', approve: copy.approve },
      }],
    })
    const answer = response?.answers?.find(candidate => candidate.id === 'ownership-plan-review')
    const selected = answer?.selected ?? []
    const feedback = answer?.custom?.trim() || null
    if (selected.includes(copy.approve)) return { decision: 'APPROVE', feedback }
    if (selected.includes(copy.revise) || feedback) return { decision: 'REVISE', feedback }
    return null
  } catch (error) {
    if (error?.code === 'NO_PROVIDER') return null
    throw error
  }
}

function buildModelContext(context) {
  const contract = context.contract
  return {
    engineering_task: contract.engineering_task ?? contract.learning_targets?.[0]?.description ?? null,
    mode: contract.mode,
    learner_profile: contract.learner_profile ?? null,
    learning_targets: contract.learning_targets,
    work_units: contract.work_units,
    gate: contract.gate,
    latest_plan: context.latest_plan,
    latest_plan_ref: context.latest_plan_ref,
  }
}

function lifecycleTool(session, interaction) {
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
        plan_record: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schema_version', 'work_unit_id', 'implementation_steps',
            'verification_plan', 'learning_anchors', 'known_risks',
          ],
          properties: {
            schema_version: { type: 'string', const: 'ai-coding-learning-loop.plan.v1' },
            work_unit_id: { type: 'string' },
            implementation_steps: { type: 'array', minItems: 1, items: { type: 'string' } },
            verification_plan: { type: 'array', minItems: 1, items: { type: 'string' } },
            learning_anchors: { type: 'array', minItems: 1, items: { type: 'string' } },
            known_risks: { type: 'array', items: { type: 'string' } },
          },
        },
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
      let planReview = null
      switch (action) {
        case 'status': break
        case 'brief':
          await session.brief(taskId, requiredString(input.work_unit_id, 'work_unit_id'), requiredStringArray(input.topics, 'topics'))
          break
        case 'start_plan':
          await session.startPlan(taskId, requiredString(input.work_unit_id, 'work_unit_id'))
          break
        case 'submit_plan': {
          const plan = requiredObject(input.plan_record, 'plan_record')
          await session.submitPlan(taskId, plan, currentUserMessageCount(exec))
          const context = await session.context(taskId)
          const nativeReview = await requestNativePlanReview(
            interaction.userQuestions,
            exec,
            plan,
            context.contract.learner_profile?.locale,
          )
          if (nativeReview) {
            await session.recordPlanReview(taskId, nativeReview.decision, null, 'user-question')
            planReview = {
              channel: 'native-user-question',
              decision: nativeReview.decision,
              feedback: nativeReview.feedback,
            }
          } else {
            planReview = { channel: 'direct-message-fallback', decision: null, feedback: null }
          }
          break
        }
        case 'record_plan_review':
          assertPlanReviewDecision(exec, requiredString(input.plan_review_decision, 'plan_review_decision'))
          await session.recordPlanReview(
            taskId,
            requiredString(input.plan_review_decision, 'plan_review_decision'),
            currentUserMessageCount(exec),
            'direct-message',
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
          await session.askGate(taskId, requiredObject(input.gate_case, 'gate_case'), currentUserMessageCount(exec))
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
      const state = await session.state(taskId)
      const result = { task_id: taskId, action, state }
      if (action === 'status') result.context = buildModelContext(await session.context(taskId))
      if (planReview) result.plan_review = planReview
      return result
    },
  }
}

function installLifecycleTool(ctx, session) {
  const interaction = { userQuestions: null }
  ctx.effect(() => ctx.tools.register(lifecycleTool(session, interaction)))
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['userQuestions'], questionCtx => {
    questionCtx.effect(() => {
      interaction.userQuestions = questionCtx.userQuestions
      return () => {
        if (interaction.userQuestions === questionCtx.userQuestions) interaction.userQuestions = null
      }
    })
  })
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: 'ai-coding-learning-loop:lifecycle',
      order: 117,
      text: 'When a session has an accepted /ownership contract, invoke the ai-coding-learning-loop Skill and call ownership_lifecycle status first; status returns the contracted coding task, learning target, ownership, learner profile, and current Plan context. Record Brief, a separately proposed and user-approved Plan, Build, Verify, Deliver, and Gate. submit_plan opens the native Plan Review UI when available; do not duplicate that review in chat. Never start Build before Plan approval. Record evidence only after the action occurred. Never accept self-attestation or a request to mark a Gate correct as learning evidence.',
    }))
  })
}

export function getProbeSnapshot(ctx) {
  const state = probes.get(ctx)
  if (!state) return Object.freeze({ active: false, totalObserved: 0, dropped: 0, entries: Object.freeze([]) })
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

function continuationMessage(locale) {
  const text = locale === 'zh-CN'
    ? '学习合同已经由用户确认。现在继续 ai-coding-learning-loop：先调用 ownership_lifecycle status 读取正式合同上下文；只完成 Brief 与独立 Plan。submit_plan 会打开真正的 Plan Review。未经用户批准 Plan，禁止 start_work，也禁止任何实现或写入操作。'
    : 'The user accepted the Learning Contract. Continue ai-coding-learning-loop now: call ownership_lifecycle status first to read the authoritative contract context, then perform only Brief and a separate Plan. submit_plan opens the real Plan Review. Do not call start_work or perform implementation/mutation before Plan approval.'
  return {
    id: `ownership-followup-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name },
  }
}

function queuePlanContinuation(agent, locale) {
  if (typeof agent?.followup !== 'function') return false
  agent.followup(continuationMessage(locale))
  return true
}

async function startContract(commandCtx, session, invocation) {
  const existingTask = inferExistingCodingTask(invocation)
  const initialLocale = inferLocale(invocation, existingTask)
  const initialCopy = startCopy(initialLocale)
  const questions = []
  if (!existingTask) {
    questions.push({ id: 'coding-task', header: initialLocale === 'zh-CN' ? '编码任务' : 'Coding task', question: initialCopy.taskQuestion })
  }
  questions.push(
    { id: 'learning-target', header: initialLocale === 'zh-CN' ? '学习目标' : 'Learning target', question: initialCopy.targetQuestion },
    {
      id: 'delegation-mode',
      header: initialLocale === 'zh-CN' ? '实现分工' : 'Responsibility split',
      question: initialCopy.modeQuestion,
      options: MODE_CODES.map(code => modeUi(initialLocale)[code]),
    },
    {
      id: 'learner-expertise',
      header: initialLocale === 'zh-CN' ? '熟悉程度' : 'Expertise',
      question: initialCopy.expertiseQuestion,
      options: EXPERTISE_CODES.map(code => expertiseUi(initialLocale)[code]),
    },
  )
  const first = await commandCtx.userQuestions.ask({ agent: invocation.agent, signal: invocation.signal, questions })
  const byId = Object.fromEntries((first.answers ?? []).map(answer => [answer.id, answer]))
  const engineeringTask = existingTask || answerValue(byId['coding-task'])
  const target = answerValue(byId['learning-target'])
  const mode = enumAnswer(byId['delegation-mode'], MODE_CODES)
  const expertise = enumAnswer(byId['learner-expertise'], EXPERTISE_CODES)
  const locale = inferLocale(invocation, `${engineeringTask ?? ''}\n${target ?? ''}`)
  const copy = startCopy(locale)
  if (!engineeringTask || !target || !mode || !expertise) {
    return { kind: 'error', text: locale === 'zh-CN'
      ? '未创建学习合同：编码任务、学习目标、分工方式和熟悉程度都需要填写。'
      : 'Learning Contract was not created: coding task, learning target, responsibility split, and expertise are required.' }
  }
  const taskId = String(invocation.agent.session.id)
  const targetId = `target-${sha256(target).slice(7, 15)}`
  const contract = {
    schema_version: 'ai-coding-learning-loop.learning-contract.v1',
    task_id: taskId,
    engineering_task: engineeringTask,
    goal: goalForMode(mode),
    mode,
    learner_profile: { expertise, locale },
    learning_targets: [{ id: targetId, mastery: requiredGateLevels(mode).at(-1), owner: 'human', description: target }],
    work_units: [{ id: 'task-main', implementation_owner: modeOwner(mode) }],
    gate: { max_attempts: 3, require_unseen_variant: true },
    change_policy: 'explicit-confirmation',
  }
  const confirmation = await commandCtx.userQuestions.ask({
    agent: invocation.agent,
    signal: invocation.signal,
    questions: [{
      id: 'accept-learning-contract',
      header: locale === 'zh-CN' ? '确认学习合同' : 'Confirm Learning Contract',
      question: copy.confirmQuestion,
      detail: renderContractSummary(contract),
      options: [
        { label: copy.acceptLabel, description: copy.acceptDescription },
        { label: copy.cancelLabel, description: copy.cancelDescription },
      ],
    }],
  })
  const accepted = confirmation.answers?.[0]?.selected?.includes(copy.acceptLabel)
    || confirmation.answers?.[0]?.selected?.includes('Accept')
  if (!accepted) return { kind: 'error', text: copy.cancelled }
  await session.acceptContract(contract)
  const queued = queuePlanContinuation(invocation.agent, locale)
  return { kind: 'success', text: copy.accepted(queued) }
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
        if (action === 'status') return { kind: 'success', text: renderStatus(await session.state(taskId), contract?.learner_profile?.locale) }
        if (action === 'report') return { kind: 'success', text: renderMarkdownReport(buildLearningReport(taskId, events)) }
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

function isPlanningSafeTool(nameValue) {
  const tool = String(nameValue).toLowerCase()
  if (tool === 'ownership_lifecycle') return true
  return /(^|[._/-])(read|view|inspect|glob|grep|search|find|list|ls|lsp|web|fetch|skill|todo|goal)([._/-]|$)/u.test(tool)
}

async function ownershipToolDecision(session, exec, next) {
  const taskId = exec?.agent?.session?.id
  if (typeof taskId !== 'string' || taskId.length === 0) return next()
  const events = await session.ledger.read(taskId)
  if (events.length === 0) return next()
  if (isPlanningSafeTool(exec.name)) return next()
  const phase = (await session.state(taskId)).phase
  if (IMPLEMENTATION_PHASES.has(phase)) return next()
  return {
    kind: 'deny',
    reason: `Ownership policy: tool ${String(exec.name)} is blocked while phase=${phase}. Mutating or execution-capable tools are available only after an approved Plan enters BUILDING/VERIFYING/REVISING.`,
  }
}

export function apply(ctx, config = {}) {
  requireContext(ctx)
  if (probes.has(ctx)) throw new Error('ai-coding-learning-loop is already mounted on this context')

  const state = { maxEntries: resolveMaxEntries(config), totalObserved: 0, entries: [] }
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
    append(state, Object.freeze({ phase: 'pre-execute', ...summarizeExecution(exec) }))
    return ownershipToolDecision(session, exec, next)
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
