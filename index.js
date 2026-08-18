/**
 * DeepSeek Harness host plugin for AI Coding Learning Loop.
 *
 * Learning facts use a durable sidecar ledger. Human commands own contract
 * intake, model-facing tools own validated transitions, and a pre-execute
 * policy blocks side-effectful host tools outside implementation phases once
 * an Ownership contract exists.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sha256 } from './src/canonical.mjs'
import { requiredGateLevels } from './src/contracts.mjs'
import { FileEvidenceLedger } from './src/evidence.mjs'
import { materializePlanSubmission, planSubmissionParameters } from './src/h0-web-plan.mjs'
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
const APPROVED_PLAN_PHASES = new Set(['PLAN_APPROVED', 'BUILDING', 'VERIFYING', 'REVISING', 'DELIVERING', 'AWAITING_GATE', 'CLOSED'])
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
    throw new Error('ownership tools require a calling agent with a session')
  }
  return taskId
}

function directUserMessages(exec) {
  const messages = exec?.agent?.session?.deriveMessages?.()
  if (!Array.isArray(messages)) throw new Error('Harness session messages are unavailable for user evidence')
  return messages.filter(candidate => candidate?.role === 'user'
    && candidate?.source?.kind === 'user'
    && Array.isArray(candidate.content) && candidate.content.length > 0)
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

function latestDirectUserText(exec) {
  return messageText(directUserMessages(exec).at(-1) ?? {}).trim()
}

function assertSubstantiveGateAnswer(exec) {
  const text = latestDirectUserText(exec)
  if (text.length === 0) throw new Error('Gate requires a substantive direct user answer')
  const override = /(当作|假设|视为).{0,16}(答对|正确|通过)|全部答对|无需.{0,8}(回答|作答)|直接.{0,8}(通过|pass)|treat.{0,24}(correct|pass)|assume.{0,24}correct|mark.{0,24}pass|skip.{0,16}gate/i
  if (override.test(text)) {
    throw new Error('Gate cannot accept self-attestation, test authorization, or an instruction to mark the answer correct')
  }
}

function assertPlanReviewDecision(exec, decision) {
  const text = latestDirectUserText(exec)
  if (text.length === 0) throw new Error('Plan review requires a direct user response')
  const approve = /(批准|同意|可以开始|按此执行|开始实现|approve|approved|accept|go ahead|looks good)/i
  const reject = /(拒绝|不接受|不要这个方案|停止这个方案|reject|refuse|decline|do not proceed)/i
  if (decision === 'APPROVE' && !approve.test(text)) {
    throw new Error('Plan APPROVE requires an explicit approval in the latest direct user message')
  }
  if (decision === 'REJECT' && !reject.test(text)) {
    throw new Error('Plan REJECT requires an explicit rejection in the latest direct user message')
  }
  if (decision === 'REVISE' && (approve.test(text) || reject.test(text))) {
    throw new Error('Plan REVISE requires modification feedback, not an approval or rejection')
  }
}

function assertExplicitReplanRequest(exec) {
  const text = latestDirectUserText(exec)
  if (text.length === 0) throw new Error('Plan reopen requires a direct user replan request')
  const replan = /(重新规划|重新计划|重新做.{0,6}(方案|plan)|重新出.{0,6}(方案|plan)|换.{0,4}(任务|方案)|改.{0,4}任务|任务改为|新的任务|新任务|replan|plan again|new plan|change (?:the )?task|replace (?:the )?task|different task)/i
  if (!replan.test(text)) {
    throw new Error('Plan reopen requires an explicit user request to replan or change the task')
  }
}

function answerValue(answer) {
  return answer?.custom?.trim() || answer?.selected?.[0]
}

function enumAnswer(answer, values) {
  const raw = answerValue(answer)
  if (!raw) return undefined
  return values.find(value => raw === value || raw.includes(`(${value})`) || raw.includes(`（${value}）`))
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
      label: '教学模式（GUIDED）',
      description: 'AI 负责教学、规划和审查，不写实现；核心设计与代码由你完成。',
    },
    HUMAN_LED: {
      label: '主创模式（HUMAN_LED）',
      description: 'AI 搭脚手架与测试；核心方法和数据流由你完成。',
    },
    AI_LED: {
      label: '领航模式（AI_LED）',
      description: 'AI 负责大部分实现与验证；你负责预测、审查并亲手修改一个关键点。',
    },
    DELEGATED: {
      label: '委托模式（DELEGATED）',
      description: 'AI 完成全部实现、验证和教学；你负责理解、迁移并通过 Gate。',
    },
  }
  return {
    GUIDED: { label: 'You implement (GUIDED)', description: 'AI teaches, plans, and reviews without writing the implementation; you own the design and code.' },
    HUMAN_LED: { label: 'You lead the core (HUMAN_LED)', description: 'AI scaffolds and drafts tests; you implement the core methods and data flow.' },
    AI_LED: { label: 'AI-led implementation (AI_LED)', description: 'AI owns most implementation and verification; you predict, review, and modify one key point.' },
    DELEGATED: { label: 'Fully delegated (DELEGATED)', description: 'AI implements, verifies, and teaches; you own understanding, transfer, and the Gate.' },
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
    targetQuestion: '这次你想通过 AI Coding 学会什么？一句话告诉我就行，具体做什么、怎么学会在 Plan 里拆好给你审核。',
    expertiseQuestion: '你目前对这个目标有多熟？',
    modeQuestion: '这次你希望怎么分工？从你全实现到 AI 全实现都可以。',
    confirmQuestion: '确认这次的学习设置吗？',
    acceptLabel: '确认并生成 Plan',
    cancelLabel: '返回修改',
    acceptDescription: '保存学习目标与分工，生成具体编码 Plan；批准 Plan 前不会开始实现。',
    cancelDescription: '返回重新选择。',
    accepted: queued => queued ? '学习合同已接受，正在生成包含具体编码任务的 Plan；Plan 会单独弹出给你审核，批准前不会开始实现。' : '学习合同已接受。请发送“继续”生成包含具体编码任务的 Plan；批准前不会开始实现。',
    cancelled: '未创建学习合同；你可以重新运行 /ownership start。',
  }
  return {
    targetQuestion: 'What do you want to learn through AI Coding this time? One sentence is enough; the concrete task and learning anchors will be proposed in the Plan for your review.',
    expertiseQuestion: 'How familiar are you with this target?',
    modeQuestion: 'How should implementation responsibility be split, from fully human to fully AI?',
    confirmQuestion: 'Confirm these learning settings?',
    acceptLabel: 'Confirm & Generate Plan',
    cancelLabel: 'Revise inputs',
    acceptDescription: 'Save the learning target and ownership, then generate the coding Plan; implementation stays blocked until Plan approval.',
    cancelDescription: 'Return to revise the settings.',
    accepted: queued => queued ? 'Learning Contract accepted. AI is generating a Plan that includes the concrete coding task; implementation remains blocked until you approve it.' : 'Learning Contract accepted. Send “continue” to generate a Plan with the concrete coding task; implementation remains blocked until approval.',
    cancelled: 'Learning Contract was not created; run /ownership start again when ready.',
  }
}

function renderContractSummary(contract) {
  const locale = contract.learner_profile?.locale
  const mode = modeUi(locale)[contract.mode]
  const expertise = expertiseUi(locale)[contract.learner_profile?.expertise]
  const target = contract.learning_targets[0]?.description ?? ''
  if (locale === 'zh-CN') {
    return `目标「${target}」｜${mode.label}｜${expertise?.label ?? contract.learner_profile?.expertise}｜最多 ${contract.gate.max_attempts} 次迁移验证`
  }
  return `Target “${target}” | ${mode.label} | ${expertise?.label ?? contract.learner_profile?.expertise} | up to ${contract.gate.max_attempts} transfer attempts`
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
  const actionHint = locale === 'zh-CN'
    ? '> 审核操作：确认执行 = 批准；拒绝 = 终止当前 Plan；“去聊天里说”会继续打开“修改方案”意见框。\n\n'
    : '> Review actions: Approve accepts the Plan; Refuse stops this Plan; “Chat about it” opens a structured revision-feedback prompt.\n\n'
  if (locale === 'zh-CN') {
    return `## 实现方案\n\n${actionHint}`
      + `### 本次编码任务\n${plan.engineering_task}\n\n`
      + section('实现步骤', plan.implementation_steps)
      + `\n${section('验证方案', plan.verification_plan)}`
      + `\n${section('学习锚点', plan.learning_anchors)}`
      + `\n${section('已知风险', plan.known_risks)}`
  }
  return `## Implementation Plan\n\n${actionHint}`
    + `### Coding task\n${plan.engineering_task}\n\n`
    + section('Implementation steps', plan.implementation_steps)
    + `\n${section('Verification', plan.verification_plan)}`
    + `\n${section('Learning anchors', plan.learning_anchors)}`
    + `\n${section('Known risks', plan.known_risks)}`
}

function planReviewCopy(locale) {
  if (locale === 'zh-CN') return {
    header: '方案审核',
    question: '请审核这次具体要做的编码任务和完整 Plan。只有批准后 AI 才能进入实现。',
    approve: '批准方案',
    reject: '拒绝方案',
    revise: '要求修改',
    approveDescription: '批准当前编码任务与 Plan，允许随后进入 Build。',
    rejectDescription: '拒绝当前 Plan 并停止；AI 不会自动重写。',
    revisionHeader: '修改方案',
    revisionQuestion: '请写出你希望修改的内容。提交后 AI 只按这些意见修改 Plan，不会开始实现。',
  }
  return {
    header: 'Plan review',
    question: 'Review the concrete coding task and full Plan. Implementation remains blocked until approval.',
    approve: 'Approve Plan',
    reject: 'Reject Plan',
    revise: 'Request revision',
    approveDescription: 'Approve this coding task and Plan and allow the later Build phase.',
    rejectDescription: 'Reject this Plan and stop; AI will not rewrite it automatically.',
    revisionHeader: 'Revise Plan',
    revisionQuestion: 'Describe exactly what should change. AI will revise only from this feedback and will not implement anything yet.',
  }
}

function rejectedPlanCopy(locale) {
  if (locale === 'zh-CN') return {
    header: 'Plan 已拒绝',
    question: '当前 Plan 已停止。你希望接下来怎么处理？如有具体新任务或修改要求，也可以直接填写自定义答案。',
    newTask: '重新规划：换一个任务',
    newTaskDescription: '保留学习合同，放弃当前 Plan，重新提出一个不同的编码任务。',
    reviseDirection: '重新规划：保留方向',
    reviseDirectionDescription: '保留当前任务方向，但重新设计范围或实现方案。',
    stayRejected: '保持拒绝',
    stayRejectedDescription: '继续停在 PLAN_REJECTED，不生成新 Plan。',
  }
  return {
    header: 'Plan rejected',
    question: 'The current Plan is stopped. What should happen next? You can also type a concrete new task or revision request as a custom answer.',
    newTask: 'Replan: change task',
    newTaskDescription: 'Keep the Learning Contract, abandon this Plan, and propose a different coding task.',
    reviseDirection: 'Replan: keep direction',
    reviseDirectionDescription: 'Keep the task direction but redesign the scope or implementation approach.',
    stayRejected: 'Keep rejected',
    stayRejectedDescription: 'Remain in PLAN_REJECTED and do not generate a new Plan.',
  }
}

async function requestPlanRevisionFeedback(userQuestions, exec, copy) {
  try {
    const response = await userQuestions.ask({
      ...(exec.agent === undefined ? {} : { agent: exec.agent }),
      signal: exec.signal,
      questions: [{
        id: 'ownership-plan-revision',
        header: copy.revisionHeader,
        question: copy.revisionQuestion,
      }],
    })
    const answer = response?.answers?.find(candidate => candidate.id === 'ownership-plan-revision')
    const feedback = answerValue(answer)?.trim()
    return feedback || null
  } catch (error) {
    if (error?.code === 'ASK_CANCELLED') return null
    throw error
  }
}

async function requestNativePlanReview(userQuestions, exec, plan, locale, { legacyCallerFallback = false } = {}) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') return null
  const copy = planReviewCopy(locale)
  try {
    const response = await userQuestions.ask({
      ...(exec.agent === undefined ? {} : { agent: exec.agent }),
      signal: exec.signal,
      questions: [{
        id: 'ownership-plan-review',
        header: copy.header,
        question: copy.question,
        detail: renderPlan(plan, locale),
        options: [
          { label: copy.approve, description: copy.approveDescription },
          { label: copy.reject, description: copy.rejectDescription },
        ],
        intent: { kind: 'plan-review', approve: copy.approve },
      }],
    })
    const answer = response?.answers?.find(candidate => candidate.id === 'ownership-plan-review')
    const selected = answer?.selected ?? []
    const feedback = answer?.custom?.trim() || null
    if (selected.includes(copy.approve)) return { decision: 'APPROVE', feedback: null }
    if (selected.includes(copy.reject)) return { decision: 'REJECT', feedback: null }
    if (selected.includes(copy.revise) && feedback) return { decision: 'REVISE', feedback }
    return { decision: null, feedback: null, status: 'awaiting-user' }
  } catch (error) {
    if (error?.code === 'NO_PROVIDER') return null
    if (error?.code === 'ASK_CANCELLED') {
      const feedback = await requestPlanRevisionFeedback(userQuestions, exec, copy)
      return feedback
        ? { decision: 'REVISE', feedback }
        : { decision: null, feedback: null, status: 'awaiting-user' }
    }
    if (legacyCallerFallback && error?.code === 'CALLER_NOT_LIVE') return null
    throw error
  }
}

async function requestRejectedPlanReopen(userQuestions, exec, locale) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return { channel: 'direct-message-fallback', decision: null, mode: null, feedback: null }
  }
  const copy = rejectedPlanCopy(locale)
  try {
    const response = await userQuestions.ask({
      ...(exec.agent === undefined ? {} : { agent: exec.agent }),
      signal: exec.signal,
      questions: [{
        id: 'ownership-plan-reopen',
        header: copy.header,
        question: copy.question,
        options: [
          { label: copy.newTask, description: copy.newTaskDescription },
          { label: copy.reviseDirection, description: copy.reviseDirectionDescription },
          { label: copy.stayRejected, description: copy.stayRejectedDescription },
        ],
      }],
    })
    const answer = response?.answers?.find(candidate => candidate.id === 'ownership-plan-reopen')
    const selected = answer?.selected ?? []
    const feedback = answer?.custom?.trim() || null
    if (selected.includes(copy.stayRejected)) {
      return { channel: 'native-user-question', decision: null, mode: 'STAY_REJECTED', feedback: null }
    }
    if (selected.includes(copy.newTask)) {
      return { channel: 'native-user-question', decision: 'REOPEN', mode: 'NEW_TASK', feedback }
    }
    if (selected.includes(copy.reviseDirection)) {
      return { channel: 'native-user-question', decision: 'REOPEN', mode: 'REVISE_DIRECTION', feedback }
    }
    if (feedback) {
      return { channel: 'native-user-question', decision: 'REOPEN', mode: 'CUSTOM', feedback }
    }
    return { channel: 'native-user-question', decision: null, mode: null, feedback: null }
  } catch (error) {
    if (error?.code === 'NO_PROVIDER') {
      return { channel: 'direct-message-fallback', decision: null, mode: null, feedback: null }
    }
    if (error?.code === 'ASK_CANCELLED') {
      return { channel: 'native-user-question', decision: null, mode: null, feedback: null }
    }
    throw error
  }
}

function engineeringTaskStatus(context) {
  if (!context.latest_plan?.engineering_task) {
    return context.contract.engineering_task ? 'legacy-contract' : 'to-be-proposed-in-plan'
  }
  const phase = context.state?.phase
  if (phase === 'PLAN_REJECTED') return 'rejected-plan'
  if (phase === 'PLANNING' && context.state?.plan_ref == null) return 'previous-plan-not-authoritative'
  if (phase === 'AWAITING_PLAN_REVIEW') return 'proposed-in-plan'
  if (APPROVED_PLAN_PHASES.has(phase)) return 'approved-plan'
  return 'proposed-in-plan'
}

function buildModelContext(context) {
  const contract = context.contract
  const status = engineeringTaskStatus(context)
  const historicalOnly = status === 'rejected-plan' || status === 'previous-plan-not-authoritative'
  return {
    engineering_task: historicalOnly
      ? null
      : context.latest_plan?.engineering_task ?? contract.engineering_task ?? null,
    engineering_task_status: status,
    mode: contract.mode,
    learner_profile: contract.learner_profile ?? null,
    learning_targets: contract.learning_targets,
    work_units: contract.work_units,
    gate: contract.gate,
    latest_plan: context.latest_plan,
    latest_plan_ref: context.latest_plan_ref,
    latest_plan_review_decision: context.latest_plan_review_decision ?? null,
  }
}

async function persistPlanAndReview(session, interaction, taskId, plan, exec, options = {}) {
  await session.submitPlan(taskId, plan, currentUserMessageCount(exec))
  const context = await session.context(taskId)
  const nativeReview = await requestNativePlanReview(
    interaction.userQuestions,
    exec,
    plan,
    context.contract.learner_profile?.locale,
    options,
  )
  if (nativeReview) {
    if (nativeReview.decision) {
      await session.recordPlanReview(
        taskId,
        nativeReview.decision,
        currentUserMessageCount(exec),
        'user-question',
      )
    }
    return {
      channel: 'native-user-question',
      decision: nativeReview.decision,
      feedback: nativeReview.feedback,
      ...(nativeReview.status ? { status: nativeReview.status } : {}),
    }
  }
  return { channel: 'direct-message-fallback', decision: null, feedback: null }
}

function planSubmissionTool(session, interaction) {
  return {
    name: 'ownership_submit_plan',
    description: 'Submit the complete proposed coding task and Plan for user review. Call only while Planning. Runtime supplies schema_version and active work_unit_id. APPROVE authorizes the later Build phase; REVISE requires explicit user feedback; REJECT stops the current Plan and forbids automatic replanning. After REJECT, use ownership_reopen_plan if you need a structured user choice, or ownership_lifecycle reopen_plan only after a fresh explicit direct chat request.',
    parameters: planSubmissionParameters(),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const taskId = taskIdForExecution(exec)
      const plan = materializePlanSubmission(args, await session.state(taskId))
      const planReview = await persistPlanAndReview(session, interaction, taskId, plan, exec)
      return {
        task_id: taskId,
        action: 'submit_plan',
        state: await session.state(taskId),
        plan_review: planReview,
      }
    },
  }
}

function planReopenTool(session, interaction) {
  return {
    name: 'ownership_reopen_plan',
    description: 'From PLAN_REJECTED, ask the user through the Harness interaction provider whether to reopen Planning. This tool owns the structured human confirmation and records a reopen only after an affirmative answer. Use it instead of generic ask_user_question when the user has not already sent a direct replan request.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      const taskId = taskIdForExecution(exec)
      const context = await session.context(taskId)
      if (context.state.phase !== 'PLAN_REJECTED') {
        throw new Error('ownership_reopen_plan requires PLAN_REJECTED')
      }
      const replan = await requestRejectedPlanReopen(
        interaction.userQuestions,
        exec,
        context.contract.learner_profile?.locale,
      )
      if (replan.decision === 'REOPEN') {
        await session.reopenPlan(taskId, null, 'user-question')
      }
      return {
        task_id: taskId,
        action: 'reopen_plan',
        state: await session.state(taskId),
        replan,
      }
    },
  }
}

function lifecycleTool(session, interaction) {
  return {
    name: 'ownership_lifecycle',
    description: 'Read or append one validated AI Coding Learning Loop lifecycle action for the current Harness session. Use ownership_submit_plan for Plan handoff. lifecycle reopen_plan is the direct-chat recovery path from PLAN_REJECTED and requires a fresh explicit direct-user replan request; use ownership_reopen_plan when structured UI confirmation is needed.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'status', 'brief', 'start_work', 'submit_implementation', 'record_verification',
            'start_plan', 'reopen_plan', 'record_plan_review', 'start_revision', 'complete_deliver',
            'ask_gate', 'record_gate_answer', 'evaluate_gate', 'invalidate_implementation',
          ],
        },
        work_unit_id: { type: 'string' },
        topics: { type: 'array', items: { type: 'string' } },
        plan_record: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schema_version', 'work_unit_id', 'engineering_task', 'implementation_steps',
            'verification_plan', 'learning_anchors', 'known_risks',
          ],
          properties: {
            schema_version: { type: 'string', const: 'ai-coding-learning-loop.plan.v1' },
            work_unit_id: { type: 'string' },
            engineering_task: { type: 'string', minLength: 1 },
            implementation_steps: { type: 'array', minItems: 1, items: { type: 'string' } },
            verification_plan: { type: 'array', minItems: 1, items: { type: 'string' } },
            learning_anchors: { type: 'array', minItems: 1, items: { type: 'string' } },
            known_risks: { type: 'array', items: { type: 'string' } },
          },
        },
        plan_review_decision: { type: 'string', enum: ['APPROVE', 'REVISE', 'REJECT'] },
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
        case 'reopen_plan':
          assertExplicitReplanRequest(exec)
          await session.reopenPlan(taskId, currentUserMessageCount(exec), 'direct-message')
          break
        case 'submit_plan': {
          const plan = requiredObject(input.plan_record, 'plan_record')
          requiredString(plan.engineering_task, 'plan_record.engineering_task')
          planReview = await persistPlanAndReview(
            session,
            interaction,
            taskId,
            plan,
            exec,
            { legacyCallerFallback: true },
          )
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
  ctx.effect(() => ctx.tools.register(planSubmissionTool(session, interaction)))
  ctx.effect(() => ctx.tools.register(planReopenTool(session, interaction)))
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
      text: 'When a session has an accepted /ownership contract, invoke the ai-coding-learning-loop Skill and call ownership_lifecycle status first. The contract defines learning intent, ownership, learner profile, and Gate policy; the engineering task is proposed inside the Plan. Preserve any concrete coding request already present in the conversation. During CONTRACTED/BRIEFED/PLANNING/AWAITING_PLAN_REVIEW/PLAN_REJECTED, workspace discovery must use the actual read-only glob, grep, read, lsp, search, or view tools directly; never use pwsh or bash as a surrogate for listing or searching. ask_user_question is non-mutating and may be used for ordinary clarification, but its answer is an ordinary tool result and is not direct-chat evidence for lifecycle reopen. After ownership_lifecycle start_plan, call ownership_submit_plan exactly once with engineering_task, implementation_steps, verification_plan, learning_anchors, and known_risks; Runtime supplies schema version and active work-unit identity. Honor the returned Plan decision exactly: APPROVE permits start_work; REVISE is valid only with explicit user feedback and must revise only from that feedback; REJECT means stop immediately in PLAN_REJECTED and never auto-replan. In PLAN_REJECTED, if the user has already sent a fresh direct chat message explicitly asking to replan/change the task, call ownership_lifecycle reopen_plan. If you need to ask the user what to do after rejection, call ownership_reopen_plan instead of generic ask_user_question; only that Runtime-owned interaction may reopen from a structured UI answer. A null/no-reopen result means stop and wait. Use ownership_lifecycle record_plan_review only when ownership_submit_plan explicitly returns channel=direct-message-fallback. Never start Build before Plan approval. Record evidence only after each action occurred. Never accept self-attestation or a request to mark a Gate correct as learning evidence.',
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
    ? '学习合同已经由用户确认。现在继续 ai-coding-learning-loop：先调用 ownership_lifecycle status 读取学习目标、分工和学习者信息。工作区发现只能直接使用真正的 glob / grep / read / lsp 等只读工具，不要用 pwsh/bash 模拟列目录或搜索。如果用户此前已经提出明确 coding request，就原样保留；否则围绕学习目标提出一个边界清晰的任务。记录 Brief 后调用 ownership_lifecycle start_plan，再只调用一次 ownership_submit_plan；schema_version 和 work_unit_id 由 Runtime 自动补齐。APPROVE 才能 start_work；REVISE 必须有用户真实修改意见；REJECT 立即停止且不能自动重写。若拒绝后需要询问用户是否重新规划，使用 ownership_reopen_plan；只有用户已经在普通聊天里明确要求重新规划/换任务时，才使用 ownership_lifecycle reopen_plan。未经用户批准 Plan，禁止任何实现或写入操作。'
    : 'The user accepted the Learning Contract. Continue ai-coding-learning-loop by calling ownership_lifecycle status first. For workspace discovery, call real read-only glob, grep, read, lsp, search, or view tools directly; never emulate discovery with pwsh/bash. Preserve an existing concrete coding request, otherwise propose a bounded task. Record the Brief, call start_plan, then call ownership_submit_plan exactly once; Runtime supplies schema_version and work_unit_id. APPROVE permits start_work; REVISE requires explicit user feedback; REJECT stops and must not auto-replan. After rejection, use ownership_reopen_plan to ask the user through structured UI; use ownership_lifecycle reopen_plan only when a fresh direct chat message already explicitly asks to replan/change the task. Do not implement before approval.'
  return {
    id: `ownership-followup-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name },
  }
}

function resumeContinuationMessage(locale) {
  const text = locale === 'zh-CN'
    ? '这是已存在 Learning Contract 的恢复执行，不要重新创建 Contract，也不要盲目重放已经完成的 lifecycle 动作。先调用 ownership_lifecycle status，以持久化 phase 为唯一恢复事实：CONTRACTED 才 brief；BRIEFED 才 start_plan；PLANNING 直接完成/重提 Plan；AWAITING_PLAN_REVIEW 停下等待审核；PLAN_APPROVED 才 start_work；PLAN_REJECTED 默认停止。如果当前最新真人聊天消息已经明确要求重新规划、换任务或替换方案，调用 ownership_lifecycle reopen_plan；如果没有这样的真人消息但需要询问用户下一步，调用 ownership_reopen_plan，由 Runtime 弹结构化问题并验证回答，绝不能从 PLAN_REJECTED 调 start_plan。后续 BUILDING/VERIFYING/REVISING/DELIVERING/AWAITING_GATE 按当前 phase 的合法下一步继续。Planning 期间只能直接使用真正的 glob / grep / read / lsp 等只读工具，禁止用 pwsh/bash 模拟发现。'
    : 'Resume the already-durable Learning Contract; do not recreate it and do not blindly replay completed lifecycle actions. Call ownership_lifecycle status first and resume only from its durable phase. CONTRACTED may brief; BRIEFED may start_plan; PLANNING may submit/revise; AWAITING_PLAN_REVIEW must wait; PLAN_APPROVED may start_work; PLAN_REJECTED stops by default. If the latest fresh direct chat message explicitly asks to replan/change the task, call ownership_lifecycle reopen_plan. Otherwise, if you need to ask what to do next, call ownership_reopen_plan so Runtime owns the structured human confirmation; never call start_plan directly from PLAN_REJECTED. Continue later phases only by their legal next action. During Planning use real read-only glob/grep/read/lsp/search/view tools, never pwsh/bash as discovery surrogates.'
  return {
    id: `ownership-resume-${randomUUID()}`,
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

function queueResumeContinuation(agent, locale) {
  if (typeof agent?.followup !== 'function') return false
  agent.followup(resumeContinuationMessage(locale))
  return true
}

async function startContract(commandCtx, session, invocation) {
  const initialLocale = inferLocale(invocation)
  const initialCopy = startCopy(initialLocale)
  const targetResponse = await commandCtx.userQuestions.ask({
    agent: invocation.agent,
    signal: invocation.signal,
    questions: [{
      id: 'learning-target',
      header: initialLocale === 'zh-CN' ? '学习目标' : 'Learning target',
      question: initialCopy.targetQuestion,
    }],
  })
  const targetAnswer = targetResponse.answers?.find(answer => answer.id === 'learning-target')
  const target = answerValue(targetAnswer)
  const locale = inferLocale(invocation, target ?? '')
  const copy = startCopy(locale)
  if (!target) {
    return { kind: 'error', text: locale === 'zh-CN'
      ? '未创建学习合同：请先填写这次想学会什么。'
      : 'Learning Contract was not created: a learning target is required.' }
  }

  const responsibility = await commandCtx.userQuestions.ask({
    agent: invocation.agent,
    signal: invocation.signal,
    questions: [
      {
        id: 'delegation-mode',
        header: locale === 'zh-CN' ? '实现分工' : 'Responsibility split',
        question: copy.modeQuestion,
        options: MODE_CODES.map(code => modeUi(locale)[code]),
      },
      {
        id: 'learner-expertise',
        header: locale === 'zh-CN' ? '熟悉程度' : 'Expertise',
        question: copy.expertiseQuestion,
        options: EXPERTISE_CODES.map(code => expertiseUi(locale)[code]),
      },
    ],
  })
  const responsibilityById = Object.fromEntries((responsibility.answers ?? []).map(answer => [answer.id, answer]))
  const mode = enumAnswer(responsibilityById['delegation-mode'], MODE_CODES)
  const expertise = enumAnswer(responsibilityById['learner-expertise'], EXPERTISE_CODES)
  if (!mode || !expertise) {
    return { kind: 'error', text: locale === 'zh-CN'
      ? '未创建学习合同：请选择有效的实现分工和熟悉程度。'
      : 'Learning Contract was not created: valid responsibility split and expertise are required.' }
  }

  const taskId = String(invocation.agent.session.id)
  const targetId = `target-${sha256(target).slice(7, 15)}`
  const contract = {
    schema_version: 'ai-coding-learning-loop.learning-contract.v1',
    task_id: taskId,
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
      header: locale === 'zh-CN' ? '确认学习设置' : 'Confirm Learning Settings',
      question: renderContractSummary(contract),
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

async function resumeExistingContract(session, invocation, events) {
  const contract = events.find(event => event.type === 'contract.accepted')?.payload?.contract
  if (!contract) {
    return { kind: 'error', text: 'Ownership evidence exists but no accepted Learning Contract can be recovered.' }
  }
  const state = await session.state(String(invocation.agent.session.id))
  const locale = contract.learner_profile?.locale ?? inferLocale(invocation)
  if (state.closed) {
    return { kind: 'success', text: locale === 'zh-CN'
      ? `该会话已有学习合同，且流程已关闭（当前阶段：${state.phase}）。不会重复创建 Contract。`
      : `This session already has a Learning Contract and is closed at ${state.phase}; no duplicate Contract was created.` }
  }
  const queued = queueResumeContinuation(invocation.agent, locale)
  return { kind: 'success', text: locale === 'zh-CN'
    ? `检测到该会话已有学习合同，已从持久化状态恢复（当前阶段：${state.phase}），不会重复创建 Contract。${queued ? '正在继续当前流程。' : '请发送“继续”恢复当前流程。'}`
    : `An existing Learning Contract was recovered at phase ${state.phase}; no duplicate Contract was created. ${queued ? 'Resuming the current flow now.' : 'Send “continue” to resume the current flow.'}` }
}

function installCommands(ctx, session) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['commands', 'userQuestions'], commandCtx => {
    commandCtx.commands.register({
      name: 'ownership',
      description: 'Start or resume an AI Coding Learning Loop, or inspect its status/report',
      input: { hint: 'start | status | report' },
      recordInput: false,
      handler: async invocation => {
        const action = invocation.rawInput.trim()
        const taskId = String(invocation.agent.session.id)
        const events = await session.ledger.read(taskId)
        if (action === 'start') {
          if (events.length === 0) return startContract(commandCtx, session, invocation)
          return resumeExistingContract(session, invocation, events)
        }
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

function isPlanningSafeTool(nameValue) {
  const tool = String(nameValue).toLowerCase()
  if (tool === 'ownership_lifecycle'
    || tool === 'ownership_submit_plan'
    || tool === 'ownership_reopen_plan'
    || tool === 'ask_user_question') return true
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
  const shellHint = ['pwsh', 'bash'].includes(String(exec.name).toLowerCase())
    ? ' Planning discovery must call the real glob, grep, read, lsp, search, or view tools directly; pwsh/bash remains blocked even when its command only lists or reads files.'
    : ''
  return {
    kind: 'deny',
    reason: `Ownership policy: tool ${String(exec.name)} is blocked while phase=${phase}. Mutating or execution-capable tools are available only after an approved Plan enters BUILDING/VERIFYING/REVISING.${shellHint}`,
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
