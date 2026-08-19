import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { canonicalize, redactEvidence, sha256 } from './canonical.mjs'

const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

function taskDirectory(root, taskId) {
  if (!TASK_ID.test(taskId)) throw new TypeError('taskId must be a portable identifier')
  const directory = resolve(root, taskId)
  if (!directory.startsWith(`${resolve(root)}/`) && directory !== resolve(root, taskId)) {
    throw new Error('task evidence path escaped its root')
  }
  return directory
}

function eventBody(input, seq, previousEventHash, now) {
  const safePayload = redactEvidence(input.payload ?? {})
  const body = {
    schema_version: 'ai-coding-learning-loop.event.v1',
    seq,
    occurred_at: now().toISOString(),
    task_id: input.task_id,
    type: input.type,
    actor: input.actor,
    work_unit_id: input.work_unit_id ?? null,
    refs: [...new Set(input.refs ?? [])].sort(),
    previous_event_hash: previousEventHash,
    payload_sha256: sha256(safePayload),
    payload: safePayload,
  }
  const eventHash = sha256(body)
  return Object.freeze({
    ...body,
    event_id: `evt_${String(seq).padStart(6, '0')}_${eventHash.slice(7, 19)}`,
    event_hash: eventHash,
  })
}

function assertEvent(event, expectedSeq, previousEventHash) {
  if (event.schema_version !== 'ai-coding-learning-loop.event.v1') throw new Error('unsupported event schema')
  if (event.seq !== expectedSeq) throw new Error(`event sequence gap at ${expectedSeq}`)
  if (event.previous_event_hash !== previousEventHash) throw new Error(`event chain mismatch at ${expectedSeq}`)
  if (event.payload_sha256 !== sha256(event.payload)) throw new Error(`event payload digest mismatch at ${expectedSeq}`)
  const { event_id: ignoredId, event_hash: ignoredHash, ...body } = event
  const expectedHash = sha256(body)
  if (event.event_hash !== expectedHash) throw new Error(`event digest mismatch at ${expectedSeq}`)
  if (event.event_id !== `evt_${String(expectedSeq).padStart(6, '0')}_${expectedHash.slice(7, 19)}`) {
    throw new Error(`event id mismatch at ${expectedSeq}`)
  }
}

export class FileEvidenceLedger {
  #queues = new Map()

  constructor(root, options = {}) {
    this.root = resolve(root)
    this.now = options.now ?? (() => new Date())
  }

  async append(input) {
    const taskId = input?.task_id
    const prior = this.#queues.get(taskId) ?? Promise.resolve()
    const current = prior.then(() => this.#appendSerialized(input))
    this.#queues.set(taskId, current.catch(() => {}))
    return current
  }

  async #appendSerialized(input) {
    if (typeof input?.type !== 'string' || input.type.length === 0) throw new TypeError('event type is required')
    if (!['user', 'agent', 'runtime', 'verifier'].includes(input?.actor)) throw new TypeError('event actor is invalid')
    const directory = taskDirectory(this.root, input.task_id)
    await mkdir(join(directory, 'events'), { recursive: true })
    const existing = await this.read(input.task_id)
    const seq = existing.length
    const previousEventHash = existing.at(-1)?.event_hash ?? null
    const event = eventBody(input, seq, previousEventHash, this.now)
    const filename = `${String(seq).padStart(6, '0')}-${event.event_hash.slice(7, 19)}.json`
    const finalPath = join(directory, 'events', filename)
    const temporaryPath = join(directory, 'events', `.${filename}.${process.pid}.tmp`)
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${canonicalize(event)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, finalPath)
    return event
  }

  async read(taskId) {
    const directory = taskDirectory(this.root, taskId)
    let names
    try {
      names = (await readdir(join(directory, 'events')))
        .filter(name => /^\d{6}-[a-f0-9]{12}\.json$/.test(name))
        .sort()
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const events = []
    let previous = null
    for (const [seq, name] of names.entries()) {
      const event = JSON.parse(await readFile(join(directory, 'events', name), 'utf8'))
      assertEvent(event, seq, previous)
      if (event.task_id !== taskId) throw new Error(`event task mismatch at ${seq}`)
      if (!name.endsWith(`${event.event_hash.slice(7, 19)}.json`)) throw new Error(`event filename mismatch at ${seq}`)
      events.push(Object.freeze(event))
      previous = event.event_hash
    }
    return Object.freeze(events)
  }

  async writeSnapshot(taskId, state) {
    const events = await this.read(taskId)
    const snapshot = {
      schema_version: 'ai-coding-learning-loop.snapshot.v1',
      task_id: taskId,
      as_of_seq: events.length - 1,
      event_hash: events.at(-1)?.event_hash ?? null,
      state,
      state_sha256: sha256(state),
    }
    const directory = taskDirectory(this.root, taskId)
    await mkdir(directory, { recursive: true })
    const temporaryPath = join(directory, `.snapshot.${process.pid}.tmp`)
    await writeFile(temporaryPath, `${canonicalize(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, join(directory, 'snapshot.json'))
    return Object.freeze(snapshot)
  }

  async readSnapshot(taskId) {
    const directory = taskDirectory(this.root, taskId)
    let snapshot
    try {
      snapshot = JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
    const events = await this.read(taskId)
    const anchor = snapshot.as_of_seq >= 0 ? events[snapshot.as_of_seq] : null
    if (snapshot.schema_version !== 'ai-coding-learning-loop.snapshot.v1') throw new Error('unsupported snapshot schema')
    if (snapshot.task_id !== taskId) throw new Error('snapshot task mismatch')
    if (!Number.isInteger(snapshot.as_of_seq) || snapshot.as_of_seq < -1 || snapshot.as_of_seq >= events.length) {
      throw new Error('snapshot sequence is outside the event log')
    }
    if (events.length > 0 && snapshot.as_of_seq === -1) throw new Error('snapshot omits an existing event prefix')
    if ((anchor?.event_hash ?? null) !== snapshot.event_hash) throw new Error('snapshot event anchor mismatch')
    if (snapshot.state_sha256 !== sha256(snapshot.state)) throw new Error('snapshot state digest mismatch')
    return Object.freeze(snapshot)
  }
}

export function evidenceFileName(path) {
  return basename(path)
}
