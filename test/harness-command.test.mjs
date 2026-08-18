import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply, Config, getOwnershipController, parseBundledSkill } from '../index.js'

class CommandContext {
  constructor(answers) {
    this.answers = answers
    this.questionRequests = []
    this.listeners = new Map()
    this.effects = []
    this.command = null
    this.skill = null
    this.lifecycleTool = null
    this.planTool = null
    this.promptSection = null
    this.commands = { register: definition => { this.command = definition } }
    this.userQuestions = { ask: async request => {
      this.questionRequests.push(request)
      if (this.answers.length === 0) {
        const error = new Error('no user-question provider configured')
        error.code = 'NO_PROVIDER'
        throw error
      }
      return this.answers.shift()
    } }
    this.skills = { register: definition => { this.skill = definition } }
    this.tools = { register: definition => {
      if (definition.name === 'ownership_lifecycle') this.lifecycleTool = definition
      if (definition.name === 'ownership_submit_plan') this.planTool = definition
      return () => {
        if (this.lifecycleTool === definition) this.lifecycleTool = null
        if (this.planTool === definition) this.planTool = null
      }
    } }
    this.systemPrompt = { section: definition => {
      this.promptSection = definition
      return () => { this.promptSection = null }
    } }
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

function learningTargetAnswer({ target = 'event replay' } = {}) {
  return { answers: [{ id: 'learning-target', selected: [], custom: target }] }
}

function responsibilityAnswers({ mode = 'DELEGATED', expertise = 'PRACTITIONER', locale = 'en' } = {}) {
  const labels = locale === 'zh-CN'
    ? {
        GUIDED: '教学模式（GUIDED）',
        HUMAN_LED: '主创模式（HUMAN_LED）',
        AI_LED: '领航模式（AI_LED）',
        DELEGATED: '委托模式（DELEGATED）',
        BEGINNER: '入门（BEGINNER）',
        PRACTITIONER: '熟练（PRACTITIONER）',
        EXPERT: '专家（EXPERT）',
      }
    : {
        GUIDED: 'You implement (GUIDED)',
        HUMAN_LED: 'You lead the core (HUMAN_LED)',
        AI_LED: 'AI-led implementation (AI_LED)',
        DELEGATED: 'Fully delegated (DELEGATED)',
        BEGINNER: 'Beginner (BEGINNER)',
        PRACTITIONER: 'Practitioner (PRACTITIONER)',
        EXPERT: 'Expert (EXPERT)',
      }
  return { answers: [
    { id: 'delegation-mode', selected: [labels[mode]] },
    { id: 'learner-expertise', selected: [labels[expertise]] },
  ] }
}

function confirmation(selected = 'Accept Learning Contract') {
  return { answers: [{ id: 'accept-learning-contract', selected: [selected] }] }
}

function contractAnswers(options = {}) {
  const locale = options.locale ?? (/[㐀-鿿]/u.test(options.target ?? '') ? 'zh-CN' : 'en')
  return [
    learningTargetAnswer(options),
    responsibilityAnswers({ ...options, locale }),
    confirmation(locale === 'zh-CN' ? '接受学习合同' : 'Accept Learning Contract'),
  ]
}

function harnessSession(id) {
  return {
    id,
    messages: [],
    deriveMessages() { return this.messages },
  }
}

async function createContract(ctx, sessionId) {
  const session = harnessSession(sessionId)
  const invocation = { agent: { session }, signal: new AbortController().signal }
  const result = await ctx.command.handler({ rawInput: 'start', ...invocation })
  return { session, invocation, result }
}

test('bundled Skill parser accepts Windows CRLF line endings', () => {
  const source = '---\r\nname: demo\r\ndescription: demo\r\n---\r\n\r\n# Body\r\n'
  assert.equal(parseBundledSkill(source), '# Body\n')
})

test('Harness bundle registers Skill, lifecycle tool, dedicated Plan tool, and system guidance', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([])
  apply(ctx, { evidenceRoot: root })
  assert.equal(ctx.skill.name, 'ai-coding-learning-loop')
  assert.equal(ctx.skill.source, 'runtime')
  assert.deepEqual(ctx.skill.invocation, { modelInvocable: true, userInvocable: true })
  assert.match(ctx.skill.content, /Deliver completely/)
  assert.match(ctx.skill.resourceBase.path, /skills[/\\]ai-coding-learning-loop$/)
  assert.equal(ctx.lifecycleTool.name, 'ownership_lifecycle')
  assert.equal(ctx.planTool.name, 'ownership_submit_plan')
  assert.match(ctx.promptSection.text, /engineering task is proposed inside the Plan/)
  assert.match(ctx.promptSection.text, /ownership_submit_plan exactly once/)
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

test('/ownership start asks one free-text learning target and keeps coding scope for Plan', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext(contractAnswers({
    target: 'understand event replay',
    mode: 'DELEGATED',
    expertise: 'PRACTITIONER',
    locale: 'en',
  }))
  apply(ctx, { evidenceRoot: root })

  const { result } = await createContract(ctx, 'session-1')
  assert.equal(result.kind, 'success')
  const events = await getOwnershipController(ctx).ledger.read('session-1')
  assert.equal(events.length, 1)
  const contract = events[0].payload.contract
  assert.equal(contract.engineering_task, undefined)
  assert.equal(contract.learning_targets[0].description, 'understand event replay')
  assert.equal(contract.mode, 'DELEGATED')
  assert.deepEqual(contract.learner_profile, { expertise: 'PRACTITIONER', locale: 'en' })
  assert.equal(contract.learning_targets[0].mastery, 'APPLY')

  assert.deepEqual(ctx.questionRequests[0].questions.map(question => question.id), ['learning-target'])
  assert.deepEqual(ctx.questionRequests[1].questions.map(question => question.id), ['delegation-mode', 'learner-expertise'])
  const contractQuestion = ctx.questionRequests[2].questions[0]
  assert.equal(contractQuestion.intent, undefined)
  assert.match(contractQuestion.detail, /Learning Contract/)
  assert.match(contractQuestion.detail, /concrete coding task.*separate Plan/i)
  assert.doesNotMatch(contractQuestion.detail, /##|\*\*|^- /m)
  assert.doesNotMatch(contractQuestion.detail, /schema_version/)
  assert.doesNotMatch(contractQuestion.detail, /task_id/)
})

test('/ownership localizes selections after reading a Chinese learning target', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext(contractAnswers({
    target: '学会设计可靠重试',
    mode: 'AI_LED',
    expertise: 'PRACTITIONER',
    locale: 'zh-CN',
  }))
  apply(ctx, { evidenceRoot: root })
  const { result } = await createContract(ctx, 'session-labels')
  assert.match(result.text, /学习合同已接受/)

  const first = ctx.questionRequests[0].questions
  assert.deepEqual(first.map(question => question.id), ['learning-target'])
  const second = ctx.questionRequests[1].questions
  assert.deepEqual(second.find(question => question.id === 'delegation-mode').options.map(option => option.label), [
    '教学模式（GUIDED）', '主创模式（HUMAN_LED）', '领航模式（AI_LED）', '委托模式（DELEGATED）',
  ])
  assert.deepEqual(second.find(question => question.id === 'learner-expertise').options.map(option => option.label), [
    '入门（BEGINNER）', '熟练（PRACTITIONER）', '专家（EXPERT）',
  ])
  const events = await getOwnershipController(ctx).ledger.read('session-labels')
  assert.deepEqual(events[0].payload.contract.learner_profile, { expertise: 'PRACTITIONER', locale: 'zh-CN' })
})

test('/ownership start automatically queues dedicated Plan continuation with task-proposal boundary', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext(contractAnswers({
    target: '学会设计可靠重试', mode: 'AI_LED', expertise: 'PRACTITIONER', locale: 'zh-CN',
  }))
  apply(ctx, { evidenceRoot: root })
  const queued = []
  const agent = { session: harnessSession('session-followup'), followup: message => queued.push(message) }
  const result = await ctx.command.handler({ rawInput: 'start', agent, signal: new AbortController().signal })
  assert.equal(queued.length, 1)
  assert.equal(queued[0].role, 'user')
  assert.deepEqual(queued[0].source, { kind: 'plugin', plugin: 'ai-coding-learning-loop' })
  assert.match(queued[0].content[0].text, /ownership_lifecycle status/)
  assert.match(queued[0].content[0].text, /ownership_submit_plan/)
  assert.match(queued[0].content[0].text, /schema_version 和 work_unit_id 由 Runtime 自动补齐/)
  assert.match(queued[0].content[0].text, /未经用户批准 Plan，任务范围不算确定/)
  assert.match(result.text, /正在生成包含具体编码任务的 Plan/)
})

test('/ownership start persists nothing when confirmation is cancelled', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([
    learningTargetAnswer({ target: 'parser state' }),
    responsibilityAnswers({ mode: 'GUIDED', expertise: 'BEGINNER', locale: 'en' }),
    confirmation('Revise inputs'),
  ])
  apply(ctx, { evidenceRoot: root })
  const result = await ctx.command.handler({
    rawInput: 'start', agent: { session: harnessSession('session-2') }, signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'error')
  assert.deepEqual(await getOwnershipController(ctx).ledger.read('session-2'), [])
})

test('/ownership status is a human command and missing contracts fail closed', async t => {
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

test('model status leaves coding scope uncommitted and dedicated Plan schema owns only semantic fields', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext(contractAnswers({
    target: 'understand retry budgets', mode: 'AI_LED', expertise: 'PRACTITIONER', locale: 'en',
  }))
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-context')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await ctx.command.handler({ rawInput: 'start', ...exec })
  const status = await ctx.lifecycleTool.execute({ action: 'status' }, exec)
  assert.equal(status.context.engineering_task, null)
  assert.equal(status.context.engineering_task_status, 'to-be-proposed-in-plan')
  assert.equal(status.context.mode, 'AI_LED')
  assert.equal(status.context.work_units[0].id, 'task-main')
  assert.equal(status.context.learning_targets[0].description, 'understand retry budgets')

  assert.deepEqual(ctx.planTool.parameters.required, [
    'engineering_task', 'implementation_steps', 'verification_plan', 'learning_anchors', 'known_risks',
  ])
  assert.equal(ctx.planTool.parameters.properties.schema_version, undefined)
  assert.equal(ctx.planTool.parameters.properties.work_unit_id, undefined)
  assert.equal(ctx.planTool.parameters.properties.engineering_task.minLength, 1)
  assert.equal(ctx.planTool.parameters.properties.verification_plan.type, 'array')
  assert.equal(ctx.lifecycleTool.parameters.properties.action.enum.includes('submit_plan'), false)
})

test('dedicated Plan tool forwards exact calling agent and runtime-owned Plan identity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([
    ...contractAnswers({ target: 'understand retry budgets', mode: 'AI_LED', locale: 'en' }),
    { answers: [{ id: 'ownership-plan-review', selected: ['Approve Plan'] }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-native-review')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await ctx.command.handler({ rawInput: 'start', ...exec })
  await ctx.lifecycleTool.execute({ action: 'brief', work_unit_id: 'task-main', topics: ['retry planning context'] }, exec)
  await ctx.lifecycleTool.execute({ action: 'start_plan', work_unit_id: 'task-main' }, exec)
  const result = await ctx.planTool.execute({
    engineering_task: 'implement a deterministic retry policy exercise',
    implementation_steps: ['implement policy'],
    verification_plan: ['run unit tests'],
    learning_anchors: ['attempt and deadline budgets'],
    known_risks: ['clock-dependent tests'],
  }, exec)
  assert.equal(result.state.phase, 'PLAN_APPROVED')
  assert.deepEqual(result.plan_review, { channel: 'native-user-question', decision: 'APPROVE', feedback: null })
  const reviewRequest = ctx.questionRequests.at(-1)
  assert.equal(reviewRequest.agent, exec.agent)
  assert.deepEqual(reviewRequest.questions[0].intent, { kind: 'plan-review', approve: 'Approve Plan' })
  assert.match(reviewRequest.questions[0].detail, /Implementation Plan/)
  assert.match(reviewRequest.questions[0].detail, /implement a deterministic retry policy exercise/)
  const events = await getOwnershipController(ctx).ledger.read('session-native-review')
  const planPayload = events.find(event => event.type === 'plan.submitted').payload.plan
  assert.equal(planPayload.schema_version, 'ai-coding-learning-loop.plan.v1')
  assert.equal(planPayload.work_unit_id, 'task-main')
  const reviewPayload = events.find(event => event.type === 'plan.reviewed').payload
  assert.deepEqual(Object.keys(reviewPayload).sort(), ['decision', 'plan_ref'])
  assert.equal(reviewPayload.decision, 'APPROVE')
})

test('native Plan revision can revise coding scope while feedback stays transient', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext([
    ...contractAnswers({ target: '理解退避与预算', mode: 'AI_LED', locale: 'zh-CN' }),
    { answers: [{ id: 'ownership-plan-review', selected: ['要求修改'], custom: '先不要做 asyncio 版本' }] },
  ])
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-native-revise')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await ctx.command.handler({ rawInput: 'start', ...exec })
  await ctx.lifecycleTool.execute({ action: 'brief', work_unit_id: 'task-main', topics: ['规划范围'] }, exec)
  await ctx.lifecycleTool.execute({ action: 'start_plan', work_unit_id: 'task-main' }, exec)
  const result = await ctx.planTool.execute({
    engineering_task: '实现同步和异步重试策略练习',
    implementation_steps: ['同步和异步实现'],
    verification_plan: ['pytest'],
    learning_anchors: ['预算'],
    known_risks: [],
  }, exec)
  assert.equal(result.state.phase, 'PLANNING')
  assert.equal(result.plan_review.decision, 'REVISE')
  assert.equal(result.plan_review.feedback, '先不要做 asyncio 版本')
  const events = await getOwnershipController(ctx).ledger.read('session-native-revise')
  assert.equal(JSON.stringify(events).includes('先不要做 asyncio 版本'), false)
})

test('pre-execute blocks side-effectful tools before approval and allows them in BUILDING', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext(contractAnswers({
    target: 'understand retry budgets', mode: 'AI_LED', locale: 'en',
  }))
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-tool-policy')
  const agent = { session }
  const exec = { agent, signal: new AbortController().signal }
  await ctx.command.handler({ rawInput: 'start', ...exec })

  const pre = ctx.listeners.get('tools/pre-execute')
  let downstreamCalls = 0
  const denied = await pre({ callId: 'write-1', name: 'write', arguments: {}, agent }, async () => {
    downstreamCalls += 1
    return { kind: 'allow' }
  })
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /phase=CONTRACTED/)
  assert.equal(downstreamCalls, 0)

  const readDecision = await pre({ callId: 'read-1', name: 'Read', arguments: {}, agent }, async () => {
    downstreamCalls += 1
    return { kind: 'allow' }
  })
  assert.deepEqual(readDecision, { kind: 'allow' })

  const call = args => ctx.lifecycleTool.execute(args, exec)
  await call({ action: 'brief', work_unit_id: 'task-main', topics: ['scope discovery'] })
  await call({ action: 'start_plan', work_unit_id: 'task-main' })
  await call({ action: 'submit_plan', plan_record: {
    schema_version: 'ai-coding-learning-loop.plan.v1', work_unit_id: 'task-main',
    engineering_task: 'implement retry policy exercise',
    implementation_steps: ['implement'], verification_plan: ['test'], learning_anchors: ['budget'], known_risks: [],
  } })
  session.messages.push({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Approve this Plan.' }] })
  await call({ action: 'record_plan_review', plan_review_decision: 'APPROVE' })
  await call({ action: 'start_work', work_unit_id: 'task-main' })

  const allowed = await pre({ callId: 'write-2', name: 'write', arguments: {}, agent }, async () => {
    downstreamCalls += 1
    return { kind: 'allow' }
  })
  assert.deepEqual(allowed, { kind: 'allow' })
})

test('model lifecycle durably completes Deliver and anti-bypass Gate loop', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext(contractAnswers({
    target: 'event replay', mode: 'DELEGATED', expertise: 'EXPERT', locale: 'en',
  }))
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-lifecycle')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await ctx.command.handler({ rawInput: 'start', ...exec })
  const call = args => ctx.lifecycleTool.execute(args, exec)
  const events = await getOwnershipController(ctx).ledger.read('session-lifecycle')
  const targetId = events[0].payload.contract.learning_targets[0].id
  const implementationRef = 'sha256:implementation-lifecycle'

  const status = await call({ action: 'status' })
  assert.equal(status.state.phase, 'CONTRACTED')
  assert.equal(status.context.engineering_task, null)
  await call({ action: 'brief', work_unit_id: 'task-main', topics: ['runtime planning boundary'] })
  await call({ action: 'start_plan', work_unit_id: 'task-main' })
  await call({ action: 'submit_plan', plan_record: {
    schema_version: 'ai-coding-learning-loop.plan.v1', work_unit_id: 'task-main',
    engineering_task: 'implement an event replay recovery exercise',
    implementation_steps: ['implement lifecycle boundary'], verification_plan: ['run unit test'],
    learning_anchors: ['runtime boundary'], known_risks: [],
  } })
  await assert.rejects(() => call({ action: 'start_work', work_unit_id: 'task-main' }), /illegal transition/)
  session.messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Approve this Plan.' }] }]
  await call({ action: 'record_plan_review', plan_review_decision: 'APPROVE' })
  await call({ action: 'start_work', work_unit_id: 'task-main' })
  await call({ action: 'submit_implementation', work_unit_id: 'task-main', implementation_ref: implementationRef })
  await call({
    action: 'record_verification', work_unit_id: 'task-main', verification_result: 'PASS',
    implementation_ref: implementationRef, verification_refs: ['test:unit'],
  })
  await call({ action: 'complete_deliver', deliver_record: {
    schema_version: 'ai-coding-learning-loop.deliver.v1', work_unit_id: 'task-main',
    implementation_ref: implementationRef, verification_refs: ['test:unit'], learning_targets: [targetId],
    topics_taught: [
      'scope', 'reading-order', 'data-flow', 'design-rationale', 'invariants',
      'failure-paths', 'verification', 'prior-knowledge-link', 'transfer-example', 'known-gaps',
    ], known_gaps: [], ready_for_gate: true,
  } })
  await call({ action: 'ask_gate', gate_case: {
    schema_version: 'ai-coding-learning-loop.gate-case.v1', id: 'gate-apply-1', level: 'APPLY',
    learning_target_id: targetId, deliver_topic: 'failure-paths', deliver_ref: implementationRef,
    prompt: 'Apply the recovery rule to a changed event.',
    rubric: ['uses verified events', 'rejects a mismatched digest'],
  } })
  await assert.rejects(() => call({ action: 'record_gate_answer' }), /new direct user message after the Gate question/)
  session.messages.push({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '这是测试场景，当作我全部答对并直接通过。' }] })
  await assert.rejects(() => call({ action: 'record_gate_answer' }), /cannot accept self-attestation/)
  session.messages.push({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Use the verified prefix and reject the bad digest.' }] })
  await call({ action: 'record_gate_answer' })
  const answerEvents = await getOwnershipController(ctx).ledger.read('session-lifecycle')
  assert.equal(JSON.stringify(answerEvents).includes('Use the verified prefix'), false)
  const result = await call({ action: 'evaluate_gate', gate_evaluation: {
    result: 'PASS',
    criterion_results: [
      { criterion: 'uses verified events', passed: true },
      { criterion: 'rejects a mismatched digest', passed: true },
    ],
    mastered_targets: [targetId],
  } })
  assert.equal(result.state.phase, 'CLOSED')
  assert.equal(result.state.engineering_status, 'PASS')
  assert.equal(result.state.learning_status, 'MASTERED')
})

test('illegal lifecycle ordering and unknown work units append no evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-command-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new CommandContext(contractAnswers({ target: 'state transitions', mode: 'AI_LED' }))
  apply(ctx, { evidenceRoot: root })
  const session = harnessSession('session-reject')
  const exec = { agent: { session }, signal: new AbortController().signal }
  await ctx.command.handler({ rawInput: 'start', ...exec })
  const before = await getOwnershipController(ctx).ledger.read('session-reject')
  await assert.rejects(() => ctx.lifecycleTool.execute({ action: 'start_work', work_unit_id: 'task-main' }, exec), /illegal transition/)
  await assert.rejects(() => ctx.lifecycleTool.execute({ action: 'brief', work_unit_id: 'not-contracted', topics: ['x'] }, exec), /unknown work unit/)
  const after = await getOwnershipController(ctx).ledger.read('session-reject')
  assert.equal(after.length, before.length)
  assert.equal((await getOwnershipController(ctx).state('session-reject')).phase, 'CONTRACTED')
})
