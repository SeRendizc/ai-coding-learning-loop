import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, getOwnershipController } from '../index.js'

class TestContext {
  constructor(answers) {
    this.answers = [...answers]
    this.questionRequests = []
    this.listeners = new Map()
    this.effects = []
    this.command = null
    this.lifecycleTool = null
    this.planTool = null
    this.commands = { register: definition => { this.command = definition } }
    this.userQuestions = { ask: async request => {
      this.questionRequests.push(request)
      if (this.answers.length === 0) {
        const error = new Error('no user-question provider configured')
        error.code = 'NO_PROVIDER'
        throw error
      }
      const next = this.answers.shift()
      if (next instanceof Error) throw next
      return next
    } }
    this.skills = { register: () => {} }
    this.tools = { register: definition => {
      if (definition.name === 'ownership_lifecycle') this.lifecycleTool = definition
      if (definition.name === 'ownership_submit_plan') this.planTool = definition
      return () => {}
    } }
    this.systemPrompt = { section: () => () => {} }
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

function cancelledQuestion() {
  const error = new Error('the user cancelled ask_user_question')
  error.code = 'ASK_CANCELLED'
  return error
}

function contractAnswers() {
  return [
    { answers: [{ id: 'learning-target', selected: [], custom: '理解本地模型部署边界' }] },
    { answers: [
      { id: 'delegation-mode', selected: ['领航模式（AI_LED）'] },
      { id: 'learner-expertise', selected: ['熟练（PRACTITIONER）'] },
    ] },
    { answers: [{ id: 'accept-learning-contract', selected: ['确认并生成 Plan'] }] },
  ]
}

function harnessSession(id) {
  return {
    id,
    messages: [],
    deriveMessages() { return this.messages },
  }
}

async function preparePlan(ctx, session, exec) {
  await ctx.command.handler({ rawInput: 'start', ...exec })
  await ctx.lifecycleTool.execute({ action: 'brief', work_unit_id: 'task-main', topics: ['规划范围'] }, exec)
  await ctx.lifecycleTool.execute({ action: 'start_plan', work_unit_id: 'task-main' }, exec)
}

const planArgs = {
  engineering_task: '实现最小本地模型加载与单次问答 CLI',
  implementation_steps: ['实现模型加载', '实现单次问答 CLI'],
  verification_plan: ['验证模型可加载并返回非空输出'],
  learning_anchors: ['device 与精度选择'],
  known_risks: ['模型下载依赖网络'],
}

test('native discuss cancellation opens structured revision feedback and only then returns REVISE', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext([
    ...contractAnswers(),
    cancelledQuestion(),
    { answers: [{ id: 'ownership-plan-revision', selected: [], custom: '删掉 benchmark，只保留加载、单次问答和最基本验证。' }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-revise')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await preparePlan(ctx, session, exec)

  const result = await ctx.planTool.execute(planArgs, exec)
  assert.equal(result.state.phase, 'PLANNING')
  assert.equal(result.plan_review.channel, 'native-user-question')
  assert.equal(result.plan_review.decision, 'REVISE')
  assert.equal(result.plan_review.feedback, '删掉 benchmark，只保留加载、单次问答和最基本验证。')

  const planRequest = ctx.questionRequests.at(-2)
  const revisionRequest = ctx.questionRequests.at(-1)
  assert.equal(planRequest.questions[0].id, 'ownership-plan-review')
  assert.deepEqual(planRequest.questions[0].options.map(option => option.label), ['批准方案', '拒绝方案'])
  assert.equal(revisionRequest.questions[0].id, 'ownership-plan-revision')
  assert.equal(revisionRequest.questions[0].header, '修改方案')
  assert.equal(revisionRequest.agent, exec.agent)

  const events = await getOwnershipController(ctx).ledger.read('session-revise')
  assert.equal(events.find(event => event.type === 'plan.reviewed').payload.decision, 'REVISE')
  assert.equal(JSON.stringify(events).includes('删掉 benchmark'), false)
})

test('native Plan rejection enters PLAN_REJECTED and never becomes an automatic revision', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext([
    ...contractAnswers(),
    { answers: [{ id: 'ownership-plan-review', selected: ['拒绝方案'] }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-reject-plan')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await preparePlan(ctx, session, exec)

  const result = await ctx.planTool.execute(planArgs, exec)
  assert.equal(result.state.phase, 'PLAN_REJECTED')
  assert.equal(result.plan_review.decision, 'REJECT')
  await assert.rejects(
    () => ctx.lifecycleTool.execute({ action: 'start_work', work_unit_id: 'task-main' }, exec),
    /illegal transition/,
  )

  const events = await getOwnershipController(ctx).ledger.read('session-reject-plan')
  const review = events.find(event => event.type === 'plan.reviewed')
  assert.equal(review.payload.decision, 'REJECT')
  assert.equal(events.filter(event => event.type === 'plan.submitted').length, 1)
})

test('cancelling both native review and revision feedback leaves the same Plan awaiting review', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext([
    ...contractAnswers(),
    cancelledQuestion(),
    cancelledQuestion(),
  ])
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-review-cancelled')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await preparePlan(ctx, session, exec)

  const result = await ctx.planTool.execute(planArgs, exec)
  assert.equal(result.state.phase, 'AWAITING_PLAN_REVIEW')
  assert.deepEqual(result.plan_review, {
    channel: 'native-user-question',
    decision: null,
    feedback: null,
    status: 'awaiting-user',
  })
  const events = await getOwnershipController(ctx).ledger.read('session-review-cancelled')
  assert.equal(events.some(event => event.type === 'plan.reviewed'), false)
  assert.equal(events.filter(event => event.type === 'plan.submitted').length, 1)
})

test('direct-message fallback counts only genuine user messages, not plugin followups', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext(contractAnswers())
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-direct-fallback')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await preparePlan(ctx, session, exec)

  session.messages.push({
    role: 'user',
    source: { kind: 'plugin', plugin: 'ai-coding-learning-loop' },
    content: [{ type: 'text', text: 'synthetic followup' }],
  })
  const submitted = await ctx.planTool.execute(planArgs, exec)
  assert.equal(submitted.state.phase, 'AWAITING_PLAN_REVIEW')
  assert.equal(submitted.plan_review.channel, 'direct-message-fallback')

  const before = await getOwnershipController(ctx).ledger.read('session-direct-fallback')
  const planEvent = before.find(event => event.type === 'plan.submitted')
  assert.equal(planEvent.payload.user_message_count_at_submit, 0)

  session.messages.push({
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: '请缩小范围，只保留最小 CLI。' }],
  })
  const reviewed = await ctx.lifecycleTool.execute({ action: 'record_plan_review', plan_review_decision: 'REVISE' }, exec)
  assert.equal(reviewed.state.phase, 'PLANNING')
})
