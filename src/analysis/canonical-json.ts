import { invalidInput } from '../errors.ts'

export interface CanonicalJsonLimits {
  readonly maxDepth?: number
  readonly maxValues?: number
  readonly maxBytes?: number
}

interface CanonicalState {
  readonly ancestors: Set<object>
  readonly maxDepth: number
  readonly maxValues: number
  values: number
}

const quote = (value: string): string => JSON.stringify(value)

const canonical = (value: unknown, state: CanonicalState, depth: number): string => {
  state.values += 1
  if (state.values > state.maxValues) throw invalidInput('Canonical JSON exceeds maxValues')
  if (depth > state.maxDepth) throw invalidInput('Canonical JSON exceeds maxDepth')
  if (value === null) return 'null'
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidInput('Canonical JSON numbers must be finite')
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (
    value === undefined ||
    typeof value === 'bigint' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw invalidInput('Canonical JSON contains an unsupported value')
  }
  if (state.ancestors.has(value)) throw invalidInput('Canonical JSON contains a cycle')
  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const entries: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw invalidInput('Canonical JSON arrays must not contain holes')
        entries.push(canonical(value[index], state, depth + 1))
      }
      return `[${entries.join(',')}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidInput('Canonical JSON objects must have a plain prototype')
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw invalidInput('Canonical JSON objects must not contain symbol keys')
    }
    const entries: string[] = []
    for (const key of Object.keys(value).sort()) {
      const property = Object.getOwnPropertyDescriptor(value, key)
      if (property === undefined || !('value' in property)) {
        throw invalidInput('Canonical JSON objects must contain only data properties')
      }
      entries.push(`${quote(key)}:${canonical(property.value, state, depth + 1)}`)
    }
    return `{${entries.join(',')}}`
  } finally {
    state.ancestors.delete(value)
  }
}

export const canonicalJson = (
  value: unknown,
  limits: Readonly<CanonicalJsonLimits> = {},
): string => {
  const maxDepth = limits.maxDepth ?? 64
  const maxValues = limits.maxValues ?? 1_000_000
  const maxBytes = limits.maxBytes ?? 64 * 1_024 * 1_024
  for (const [name, limit] of Object.entries({ maxDepth, maxValues, maxBytes })) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw invalidInput(`${name} must be a positive safe integer`)
    }
  }
  const output = canonical(
    value,
    { ancestors: new Set<object>(), maxDepth, maxValues, values: 0 },
    0,
  )
  if (new TextEncoder().encode(output).byteLength > maxBytes) {
    throw invalidInput('Canonical JSON exceeds maxBytes')
  }
  return output
}

const hex = (bytes: Uint8Array): string => {
  let output = ''
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0')
  return output
}

export const sha256Text = async (domain: string, text: string): Promise<string> => {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw invalidInput('SHA-256 requires the Web Crypto API')
  }
  const bytes = new TextEncoder().encode(`${domain}\u0000${text}`)
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)))
}

export const hashCanonicalJson = async (
  domain: string,
  value: unknown,
  limits: Readonly<CanonicalJsonLimits> = {},
): Promise<string> => sha256Text(domain, canonicalJson(value, limits))
