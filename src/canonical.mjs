import { createHash } from 'node:crypto'

const SENSITIVE_KEY = /(?:answer|authorization|content|credential|key|password|prompt|secret|token)/i
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

function normalize(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(item => normalize(item, seen))
  if (typeof value !== 'object') throw new TypeError('evidence values must be lossless JSON values')
  if (seen.has(value)) throw new TypeError('evidence values must not contain cycles')
  seen.add(value)
  const output = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`undefined is not allowed at ${key}`)
    output[key] = normalize(value[key], seen)
  }
  seen.delete(value)
  return output
}

export function canonicalize(value) {
  return JSON.stringify(normalize(value, new Set()))
}

export function sha256(value) {
  const bytes = typeof value === 'string' ? value : canonicalize(value)
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence)
  if (value === null || typeof value !== 'object') return value
  const output = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = key.endsWith('_sha256') && typeof item === 'string' && SHA256_DIGEST.test(item)
      ? item
      : SENSITIVE_KEY.test(key)
      ? Object.freeze({ redacted: true, digest: sha256(item) })
      : redactEvidence(item)
  }
  return output
}
