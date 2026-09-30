export const subjects = ['purejsimage', 'jsquash', 'oxide', 'vips'] as const
export type Subject = (typeof subjects)[number]
export const statuses = [
  'verified',
  'API not exposed',
  'unsupported input',
  'incorrect output',
  'execution failure',
  'environment unavailable',
  'not tested',
] as const
export type Status = (typeof statuses)[number]
export type Samples = Uint8Array | Uint16Array | Float32Array
export interface Pixels {
  width: number
  height: number
  channels: number
  data: Samples
  interpretation: string
}
export type Output = { kind: 'pixels'; pixels: Pixels } | { kind: 'png' | 'jxl'; bytes: Uint8Array }
export interface Settings {
  lossless: boolean
  effort: number
  value: number
}
export interface Adapter {
  decode(bytes: Uint8Array, nativePrecision?: boolean): Promise<Output>
  encode?: (pixels: Pixels, settings: Settings) => Promise<Output>
  close(): void
}
export interface Fixture {
  id: string
  category: string
  scope: 'capped' | 'original' | 'specialized'
  width: number
  height: number
  source: string
  sourceSha256: string
  provenance: string
  preparation: string
  raw: string
  rawSha256: string
  channels: number
  sampleType: 'uint8' | 'uint16' | 'float32'
  lossless: string
  losslessSha256: string
  lossy: string | null
  lossySha256: string | null
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object')
  return Object.fromEntries(Object.entries(value))
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string')
  return value
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected finite number')
  return value
}
export function parseFixture(value: unknown): Fixture {
  const v = object(value),
    scope = v.scope,
    sampleType = v.sampleType
  if (scope !== 'capped' && scope !== 'original' && scope !== 'specialized')
    throw new Error('Invalid scope')
  if (sampleType !== 'uint8' && sampleType !== 'uint16' && sampleType !== 'float32')
    throw new Error('Invalid sample type')
  return {
    id: string(v.id),
    category: string(v.category),
    scope,
    sampleType,
    width: number(v.width),
    height: number(v.height),
    channels: number(v.channels),
    source: string(v.source),
    sourceSha256: string(v.sourceSha256),
    provenance: string(v.provenance),
    preparation: string(v.preparation),
    raw: string(v.raw),
    rawSha256: string(v.rawSha256),
    lossless: string(v.lossless),
    losslessSha256: string(v.losslessSha256),
    lossy: v.lossy === null ? null : string(v.lossy),
    lossySha256: v.lossySha256 === null ? null : string(v.lossySha256),
  }
}
export function validatePixels(
  actual: Pixels,
  expected: Pixels,
  tolerance: number,
): { status: Status; detail: string; maximumError: number | null } {
  if (
    actual.width !== expected.width ||
    actual.height !== expected.height ||
    actual.channels !== expected.channels ||
    actual.data.constructor !== expected.data.constructor ||
    actual.data.length !== expected.data.length ||
    actual.interpretation !== expected.interpretation
  )
    return {
      status: 'incorrect output',
      detail: `Shape/type/color mismatch: ${actual.width}x${actual.height}/${actual.channels}/${actual.data.constructor.name}/${actual.interpretation}; expected ${expected.width}x${expected.height}/${expected.channels}/${expected.data.constructor.name}/${expected.interpretation}`,
      maximumError: null,
    }
  let maximumError = 0
  for (let i = 0; i < actual.data.length; i++) {
    const a = actual.data[i],
      b = expected.data[i]
    if (a === undefined || b === undefined || !Number.isFinite(a))
      return { status: 'incorrect output', detail: 'Invalid sample', maximumError: null }
    maximumError = Math.max(maximumError, Math.abs(a - b))
  }
  return {
    status: maximumError <= tolerance ? 'verified' : 'incorrect output',
    detail: `All ${actual.data.length} samples compared, maximum error ${maximumError}, tolerance ${tolerance}`,
    maximumError,
  }
}
export function summarize(values: readonly number[]) {
  if (!values.length) return null
  if (values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Invalid measurement')
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2)
  return {
    median: sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2,
    minimum: sorted[0],
    maximum: sorted.at(-1),
    count: sorted.length,
  }
}
/** Lossy defaults may change alpha unless the public API promises exact alpha. */
export function lossyOutputStatus(
  shapeMatches: boolean,
  maximumAlphaError: number,
  exactAlphaRequired: boolean,
): Status {
  if (!Number.isFinite(maximumAlphaError) || maximumAlphaError < 0)
    throw new Error('Invalid alpha error')
  return shapeMatches && (!exactAlphaRequired || maximumAlphaError === 0)
    ? 'verified'
    : 'incorrect output'
}

export class OutputMismatch extends Error {}

export function classifyError(error: unknown): { status: Status; detail: string } {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return {
    status:
      error instanceof OutputMismatch
        ? 'incorrect output'
        : code === 'UNSUPPORTED_OPERATION' || code === 'UNSUPPORTED_FORMAT'
          ? 'unsupported input'
          : 'execution failure',
    detail,
  }
}
export function counts(rows: readonly { status: Status }[]): Record<Status, number> {
  const result: Record<Status, number> = {
    verified: 0,
    'API not exposed': 0,
    'unsupported input': 0,
    'incorrect output': 0,
    'execution failure': 0,
    'environment unavailable': 0,
    'not tested': 0,
  }
  for (const row of rows) result[row.status]++
  return result
}
export function rgba8(p: Pixels): Pixels {
  if (!(p.data instanceof Uint8Array)) throw new Error('Explicit precision conversion required')
  if (p.channels === 4) return p
  if (p.channels !== 1 && p.channels !== 3) throw new Error('Unsupported channel layout')
  const data = new Uint8Array(p.width * p.height * 4)
  for (let i = 0; i < p.width * p.height; i++) {
    for (let c = 0; c < 3; c++)
      data[i * 4 + c] = p.data[i * p.channels + (p.channels === 1 ? 0 : c)] ?? 0
    data[i * 4 + 3] = 255
  }
  return { ...p, channels: 4, data, interpretation: 'srgb' }
}
