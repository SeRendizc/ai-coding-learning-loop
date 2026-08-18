import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, getOwnershipController } from '../index.js'

class TestContext {
  constructor(answers = []) {
    this.answers = [...answers]
    this.questionRequests = []
    this.listeners = new Map()
    this.effects = []
    this.command = null
    this.lifecycleTool = null
    this.planTool = null
    this.reopenTool = null
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
      if (definition.name === 'ownership_reopen_plan') this.reopenTool = definition
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

function contractAnswers() {
  return [
    { answers: [{ id: 'learning-target', selected: [], custom: 'agent技术' }] },
    { answers: [
      { id: 'delegation-mode', selected: ['委托模式（DELEGATED）'] },
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

function directUser(text) {
  return { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

const firstPlan = {
  engineering_task: '实现一个玩具 Agent 决策函数',
  implementation_steps: ['实现简单决策'],
  verification_plan: ['运行单元测试'],
  learning_anchors: ['agent loop'],
  known_risks: ['任务过于表层'],
}

const replacementPlan = {
  engineering_task: '实现一个最小 Agent Runtime 执行引擎，包含状态、工具调度和终止条件',
  implementation_steps: ['定义运行状态', '实现工具调度循环', '实现确定性终止条件'],
  verification_plan: ['用 scripted model 和 fake tools 验证完整执行循环'],
  learning_anchors: ['agent loop', 'tool dispatch', 'termination invariant'],
  known_risks: ['范围需保持最小'],
}

test('/ownership start resumes an existing durable Contract after continuation failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-recovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext(contractAnswers())
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-restart-safe')
  const followups = []
  const agent = { session, followup: message => followups.push(message) }
  const invocation = { agent, signal: new AbortController().signal }

  const first = await ctx.command.handler({ rawInput: 'start', ...invocation })
  assert.equal(first.kind, 'success')
  assert.equal(followups.length, 1)
  const questionCount = ctx.questionRequests.length

  // Simulate the automatically queued model turn failing before any lifecycle
  // transition (provider/network/credential failures all leave CONTRACTED durable).
  const second = await ctx.command.handler({ rawInput: 'start', ...invocation })
  assert.equal(second.kind, 'success')
  assert.match(second.text, /已有学习合同/)
  assert.match(second.text, /CONTRACTED/)
  assert.match(second.text, /不会重复创建 Contract/)
  assert.equal(ctx.questionRequests.length, questionCount)
  assert.equal(followups.length, 2)
  assert.match(followups[1].content[0].text, /已存在 Learning Contract 的恢复执行/)
  assert.match(followups[1].content[0].text, /不要重新创建 Contract/)

  const events = await getOwnershipController(ctx).ledger.read('session-restart-safe')
  assert.equal(events.filter(event => event.type === 'contract.accepted').length, 1)
  assert.equal(events.length, 1)
})

test('PLAN_REJECTED can reopen only through fresh explicit direct-user replan evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-replan-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext([
    ...contractAnswers(),
    { answers: [{ id: 'ownership-plan-review', selected: ['拒绝方案'] }] },
    { answers: [{ id: 'ownership-plan-review', selected: ['批准方案'] }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-explicit-replan')
  const exec = { agent: { session }, signal: new AbortController().signal }

  await ctx.command.handler({ rawInput: 'start', ...exec })
  await ctx.lifecycleTool.execute({ action: 'brief', work_unit_id: 'task-main', topics: ['agent runtime 规划'] }, exec)
  await ctx.lifecycleTool.execute({ action: 'start_plan', work_unit_id: 'task-main' }, exec)
  const rejected = await ctx.planTool.execute(firstPlan, exec)
  assert.equal(rejected.state.phase, 'PLAN_REJECTED')
  assert.equal(rejected.plan_review.decision, 'REJECT')

  const rejectedStatus = await ctx.lifecycleTool.execute({ action: 'status' }, exec)
  assert.equal(rejectedStatus.context.engineering_task, null)
  assert.equal(rejectedStatus.context.engineering_task_status, 'rejected-plan')
  assert.equal(rejectedStatus.context.latest_plan_review_decision, 'REJECT')

  await assert.rejects(
    () => ctx.lifecycleTool.execute({ action: 'start_plan', work_unit_id: 'task-main' }, exec),
    /plan start requires BRIEFED/,
  )
  await assert.rejects(
    () => ctx.lifecycleTool.execute({ action: 'reopen_plan' }, exec),
    /direct user replan request/,
  )

  session.messages.push(directUser('这个方案就是不行。'))
  await assert.rejects(
    () => ctx.lifecycleTool.execute({ action: 'reopen_plan' }, exec),
    /explicit user request to replan or change the task/,
  )

  session.messages.push(directUser('重新规划，任务改为我刚刚说的新任务：做底层 Agent Runtime 执行引擎。'))
  const reopened = await ctx.lifecycleTool.execute({ action: 'reopen_plan' }, exec)
  assert.equal(reopened.state.phase, 'PLANNING')
  assert.equal(reopened.state.plan_ref, null)

  const afterReopen = await ctx.lifecycleTool.execute({ action: 'status' }, exec)
  assert.equal(afterReopen.context.engineering_task, null)
  assert.equal(afterReopen.context.engineering_task_status, 'previous-plan-not-authoritative')
  assert.equal(afterReopen.context.latest_plan.engineering_task, firstPlan.engineering_task)

  const approved = await ctx.planTool.execute(replacementPlan, exec)
  assert.equal(approved.state.phase, 'PLAN_APPROVED')
  const approvedStatus = await ctx.lifecycleTool.execute({ action: 'status' }, exec)
  assert.equal(approvedStatus.context.engineering_task, replacementPlan.engineering_task)
  assert.equal(approvedStatus.context.engineering_task_status, 'approved-plan')

  const events = await getOwnershipController(ctx).ledger.read('session-explicit-replan')
  assert.equal(events.filter(event => event.type === 'plan.submitted').length, 2)
  assert.equal(events.filter(event => event.type === 'plan.reopened').length, 1)
  assert.equal(events.find(event => event.type === 'plan.reopened').payload.reopen_source, 'direct-message')
  assert.equal(JSON.stringify(events).includes('做底层 Agent Runtime 执行引擎'), false)
})

test('PLAN_REJECTED structured UI can reopen without pretending the answer is a direct chat message', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-replan-question-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext([
    ...contractAnswers(),
    { answers: [{ id: 'ownership-plan-review', selected: ['拒绝方案'] }] },
    { answers: [{
      id: 'ownership-plan-reopen',
      selected: ['重新规划：换一个任务'],
      custom: '换成实现一个最小 durable tool dispatcher',
    }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-structured-replan')
  const agent = { session }
  const exec = { agent, signal: new AbortController().signal }

  await ctx.command.handler({ rawInput: 'start', ...exec })
  await ctx.lifecycleTool.execute({ action: 'brief', work_unit_id: 'task-main', topics: ['agent infra'] }, exec)
  await ctx.lifecycleTool.execute({ action: 'start_plan', work_unit_id: 'task-main' }, exec)
  const rejected = await ctx.planTool.execute(firstPlan, exec)
  assert.equal(rejected.state.phase, 'PLAN_REJECTED')
  assert.equal(session.messages.length, 0)

  const pre = ctx.listeners.get('tools/pre-execute')
  let genericQuestionDownstream = 0
  const genericQuestionDecision = await pre({
    callId: 'ask-safe',
    name: 'ask_user_question',
    arguments: { questions: [] },
    agent,
  }, async () => {
    genericQuestionDownstream += 1
    return { kind: 'allow' }
  })
  assert.deepEqual(genericQuestionDecision, { kind: 'allow' })
  assert.equal(genericQuestionDownstream, 1)

  const reopened = await ctx.reopenTool.execute({}, exec)
  assert.equal(reopened.state.phase, 'PLANNING')
  assert.equal(reopened.replan.decision, 'REOPEN')
  assert.equal(reopened.replan.mode, 'NEW_TASK')
  assert.equal(reopened.replan.feedback, '换成实现一个最小 durable tool dispatcher')
  assert.equal(session.messages.length, 0)

  const request = ctx.questionRequests.at(-1)
  assert.equal(request.agent, exec.agent)
  assert.equal(request.questions[0].id, 'ownership-plan-reopen')
  assert.match(request.questions[0].question, /接下来怎么处理/)

  const events = await getOwnershipController(ctx).ledger.read('session-structured-replan')
  const reopenEvents = events.filter(event => event.type === 'plan.reopened')
  assert.equal(reopenEvents.length, 1)
  assert.equal(reopenEvents[0].payload.reopen_source, 'user-question')
  assert.equal(JSON.stringify(events).includes('durable tool dispatcher'), false)
})

test('pre-Build shell discovery stays denied and tells the model to use real read tools', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-shell-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new TestContext(contractAnswers())
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-shell-policy')
  const agent = { session }
  await ctx.command.handler({ rawInput: 'start', agent, signal: new AbortController().signal })

  const pre = ctx.listeners.get('tools/pre-execute')
  let downstream = 0
  const denied = await pre({
    callId: 'pwsh-readonly-looking',
    name: 'pwsh',
    arguments: { command: 'Get-ChildItem -Recurse', description: 'Glob **/*' },
    agent,
  }, async () => {
    downstream += 1
    return { kind: 'allow' }
  })

  assert.equal(denied.kind, 'deny')
  assert.equal(downstream, 0)
  assert.match(denied.reason, /phase=CONTRACTED/)
  assert.match(denied.reason, /real glob, grep, read, lsp/i)
  assert.match(denied.reason, /pwsh\/bash remains blocked/i)
})
