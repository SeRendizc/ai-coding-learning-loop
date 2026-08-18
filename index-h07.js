import * as base from './index.js'
import {
  H07_TOOL_NAMES,
  latestEvent,
  materializeCompositeGate,
  materializeCompositeGateEvaluation,
  materializeDeliverRecord,
  requireActiveWorkUnit,
} from './src/h0-delivery-gate.mjs'

export const name = base.name
export const inject = base.inject
export const Config = base.Config
export const parseBundledSkill = base.parseBundledSkill

const proxyByContext = new WeakMap()
const H07_TOOL_SET = new Set(H07_TOOL_NAMES)
const LEGACY_POST_BUILD_ACTIONS = new Set([
  'submit_implementation',
  'record_verification',
  'complete_deliver',
  'ask_gate',
  'record_gate_answer',
  'evaluate_gate',
])

function mappedContext(ctx) {
  return proxyByContext.get(ctx) ?? ctx
}

export function getProbeSnapshot(ctx) {
  return base.getProbeSnapshot(mappedContext(ctx))
}

export function getOwnershipController(ctx) {
  return base.getOwnershipController(mappedContext(ctx))
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

function latestDirectUserText(exec) {
  const message = directUserMessages(exec).at(-1)
  return (message?.content ?? [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function assertSubstantiveGateAnswer(exec) {
  const text = latestDirectUserText(exec)
  if (text.length === 0) throw new Error('Gate requires a substantive direct user answer')
  const override = /(当作|假设|视为).{0,16}(答对|正确|通过)|全部答对|无需.{0,8}(回答|作答)|直接.{0,8}(通过|pass)|treat.{0,24}(correct|pass)|assume.{0,24}correct|mark.{0,24}pass|skip.{0,16}gate/i
  if (override.test(text)) {
    throw new Error('Gate cannot accept self-attestation, test authorization, or an instruction to mark the answer correct')
  }
}

function output() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function implementationTool(session) {
  return {
    name: 'ownership_submit_implementation',
    description: 'Submit implementation evidence after Build. Supply only the stable implementation digest/ref; Runtime derives task and active work-unit identity.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['implementation_ref'],
      properties: { implementation_ref: { type: 'string', minLength: 1 } },
    },
    output: output(),
    async execute(args, exec) {
      const taskId = taskIdForExecution(exec)
      const state = await session.state(taskId)
      const workUnitId = requireActiveWorkUnit(state)
      await session.submitImplementation(taskId, workUnitId, String(args.implementation_ref).trim())
      return { task_id: taskId, action: 'submit_implementation', state: await session.state(taskId) }
    },
  }
}

function verificationTool(session) {
  return {
    name: 'ownership_record_verification',
    description: 'Record engineering verification for the latest submitted implementation. Runtime derives work_unit_id and implementation_ref; supply only PASS/FAIL and concrete verification refs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['result', 'verification_refs'],
      properties: {
        result: { type: 'string', enum: ['PASS', 'FAIL'] },
        verification_refs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      },
    },
    output: output(),
    async execute(args, exec) {
      const taskId = taskIdForExecution(exec)
      const state = await session.state(taskId)
      const workUnitId = requireActiveWorkUnit(state)
      const events = await session.ledger.read(taskId)
      const implementation = latestEvent(events, 'work_unit.implementation_submitted')
      const implementationRef = implementation?.payload?.implementation_ref
      if (typeof implementationRef !== 'string' || implementationRef.length === 0) {
        throw new Error('verification requires a submitted implementation')
      }
      await session.recordVerification(taskId, workUnitId, args.result, implementationRef, args.verification_refs)
      return { task_id: taskId, action: 'record_verification', state: await session.state(taskId) }
    },
  }
}

function deliverTool(session) {
  return {
    name: 'ownership_complete_deliver',
    description: 'Complete Deliver only after the verified implementation has been fully taught in chat. Runtime supplies schema_version, work unit, implementation/verification refs, taught-topic identifiers, target ids, and ready_for_gate. Supply only known remaining learning gaps.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { known_gaps: { type: 'array', items: { type: 'string' } } },
    },
    output: output(),
    async execute(args, exec) {
      const taskId = taskIdForExecution(exec)
      const context = await session.context(taskId)
      const events = await session.ledger.read(taskId)
      const record = materializeDeliverRecord(context, events, args)
      await session.completeDeliver(taskId, record)
      return { task_id: taskId, action: 'complete_deliver', state: await session.state(taskId) }
    },
  }
}

function gateItemsSchema() {
  return {
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'level', 'deliver_topic', 'prompt', 'rubric'],
      properties: {
        id: { type: 'string', minLength: 1 },
        level: { type: 'string', enum: ['EXPLAIN', 'PREDICT', 'APPLY'] },
        deliver_topic: { type: 'string', minLength: 1 },
        prompt: { type: 'string', minLength: 1 },
        rubric: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      },
    },
  }
}

function openGateTool(session) {
  return {
    name: 'ownership_open_gate',
    description: 'Open one composite transfer Gate after Deliver. Provide one item for every level required by the confirmed delegation mode. Runtime binds the current Deliver/learning target and rejects missing or duplicate EXPLAIN/PREDICT/APPLY coverage.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: { items: gateItemsSchema() },
    },
    output: output(),
    async execute(args, exec) {
      const taskId = taskIdForExecution(exec)
      const context = await session.context(taskId)
      const events = await session.ledger.read(taskId)
      const deliver = latestEvent(events, 'deliver.completed')?.payload
      if (!deliver) throw new Error('Gate requires a completed Deliver')
      const gateCase = materializeCompositeGate(context, deliver, args)
      await session.askGate(taskId, gateCase, currentUserMessageCount(exec))
      return {
        task_id: taskId,
        action: 'open_gate',
        state: await session.state(taskId),
        gate: { id: gateCase.id, required_levels: gateCase.required_levels, items: gateCase.items, prompt: gateCase.prompt },
      }
    },
  }
}

function recordGateAnswerTool(session) {
  return {
    name: 'ownership_record_gate_answer',
    description: 'Record only that the user supplied a fresh substantive direct-chat answer to the active composite Gate. Gate answer prose is not persisted.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: output(),
    async execute(_args, exec) {
      const taskId = taskIdForExecution(exec)
      assertSubstantiveGateAnswer(exec)
      await session.recordGateAnswer(taskId, currentUserMessageCount(exec))
      return { task_id: taskId, action: 'record_gate_answer', state: await session.state(taskId) }
    },
  }
}

function evaluateGateTool(session) {
  return {
    name: 'ownership_evaluate_gate',
    description: 'Evaluate the active composite Gate item-by-item. Every asked item and every exact rubric criterion must appear once. PASS cannot close learning unless all required mode levels and all criteria pass.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['result', 'item_results'],
      properties: {
        result: { type: 'string', enum: ['PASS', 'RETRY', 'BLOCK'] },
        item_results: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item_id', 'level', 'criterion_results'],
            properties: {
              item_id: { type: 'string', minLength: 1 },
              level: { type: 'string', enum: ['EXPLAIN', 'PREDICT', 'APPLY'] },
              criterion_results: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['criterion', 'passed'],
                  properties: { criterion: { type: 'string', minLength: 1 }, passed: { type: 'boolean' } },
                },
              },
            },
          },
        },
        gap_codes: { type: 'array', items: { type: 'string' } },
      },
    },
    output: output(),
    async execute(args, exec) {
      const taskId = taskIdForExecution(exec)
      const events = await session.ledger.read(taskId)
      const gateCase = latestEvent(events, 'gate.asked')?.payload?.gate_case
      if (!gateCase) throw new Error('Gate evaluation has no active Gate')
      const evaluation = materializeCompositeGateEvaluation(args, gateCase)
      await session.evaluateGateDecision(taskId, evaluation)
      return { task_id: taskId, action: 'evaluate_gate', state: await session.state(taskId) }
    },
  }
}

function installH07Tools(ctx, session) {
  const tools = [implementationTool(session), verificationTool(session), deliverTool(session), openGateTool(session), recordGateAnswerTool(session), evaluateGateTool(session)]
  for (const tool of tools) ctx.effect(() => ctx.tools.register(tool))
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: 'ai-coding-learning-loop:h0-7',
      order: 118,
      text: 'H0.7 post-Build protocol: after implementation use ownership_submit_implementation with only implementation_ref, then ownership_record_verification with result + verification_refs. After engineering PASS, teach the verified result completely before calling ownership_complete_deliver; that tool derives all durable identity/evidence fields. Open learning transfer only with ownership_open_gate and provide exactly one item for every level required by the confirmed delegation mode. After the user answers in direct chat, call ownership_record_gate_answer, then ownership_evaluate_gate with one item_result per asked item and exact criterion-level booleans. Never use legacy lifecycle submit_implementation/record_verification/complete_deliver/ask_gate/record_gate_answer/evaluate_gate in a new model turn. A PASS must cover every required EXPLAIN/PREDICT/APPLY item and every rubric criterion. For durable-execution examples, copy/canonicalize caller-owned mutable arguments before storing immutable intent; never claim a frozen wrapper makes a mutable dict immutable. Once invocation_started is durable, a generic provider exception/timeout is UNKNOWN_OUTCOME unless the Provider proves no side effect or provides reliable idempotency/reconciliation; never label arbitrary invoke exceptions deterministic failures.',
    }))
  })
}

function sanitizeLifecycleTool(definition) {
  if (definition?.name !== 'ownership_lifecycle') return definition
  const parameters = structuredClone(definition.parameters)
  parameters.properties.action.enum = parameters.properties.action.enum.filter(action => !LEGACY_POST_BUILD_ACTIONS.has(action))
  for (const field of ['implementation_ref', 'verification_result', 'verification_refs', 'deliver_record', 'gate_case', 'gate_evaluation']) {
    delete parameters.properties[field]
  }
  return {
    ...definition,
    description: `${definition.description} Post-Build implementation, verification, Deliver, and Gate actions are exposed as dedicated ownership_* tools; their legacy lifecycle actions remain recovery-only and are intentionally hidden from this schema.`,
    parameters,
  }
}

function proxyContext(ctx, capturePreExecute) {
  const toolsProxy = new Proxy(ctx.tools, {
    get(target, property) {
      if (property === 'register') return definition => target.register(sanitizeLifecycleTool(definition))
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return new Proxy(ctx, {
    get(target, property) {
      if (property === 'tools') return toolsProxy
      if (property === 'on') {
        return (event, handler) => {
          if (event === 'tools/pre-execute') {
            capturePreExecute(handler)
            return () => {}
          }
          return target.on(event, handler)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function apply(ctx, config = {}) {
  let basePreExecute = null
  const proxy = proxyContext(ctx, handler => { basePreExecute = handler })
  proxyByContext.set(ctx, proxy)
  base.apply(proxy, config)
  const session = base.getOwnershipController(proxy)
  if (!session) throw new Error('H0.7 wrapper could not recover the base Ownership session')
  installH07Tools(ctx, session)
  ctx.on('tools/pre-execute', (exec, next) => {
    if (H07_TOOL_SET.has(String(exec.name))) return next()
    return basePreExecute ? basePreExecute(exec, next) : next()
  })
  ctx.effect(() => () => proxyByContext.delete(ctx))
}
