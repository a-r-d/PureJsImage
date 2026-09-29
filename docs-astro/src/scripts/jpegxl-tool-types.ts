export const toolNames = ['animation', 'native', 'progressive'] as const
export interface JxlToolRequest {
  type: 'tool'
  requestId: number
  generation: number
  tool: 'animation' | 'native' | 'progressive'
  action: string
  file?: File
  url?: string
  files?: File[]
  options: Record<string, unknown>
}
export interface JxlToolResponse {
  type: 'tool-event'
  requestId: number
  generation: number
  state: 'opened' | 'stage' | 'done' | 'output'
  message: string
  info: Record<string, unknown>
  image?: { width: number; height: number; rgba: ArrayBuffer }
  bytes?: ArrayBuffer
  name?: string
}
export const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
export const isJxlToolRequest = (v: unknown): v is JxlToolRequest =>
  record(v) &&
  v.type === 'tool' &&
  Number.isSafeInteger(v.requestId) &&
  Number.isSafeInteger(v.generation) &&
  toolNames.some((t) => t === v.tool) &&
  typeof v.action === 'string' &&
  record(v.options) &&
  (v.file === undefined || v.file instanceof File) &&
  (v.url === undefined || typeof v.url === 'string') &&
  (v.files === undefined ||
    (Array.isArray(v.files) && v.files.length <= 16 && v.files.every((f) => f instanceof File)))
export const isJxlToolResponse = (v: unknown): v is JxlToolResponse =>
  record(v) &&
  v.type === 'tool-event' &&
  Number.isSafeInteger(v.requestId) &&
  Number.isSafeInteger(v.generation) &&
  ['opened', 'stage', 'done', 'output'].includes(String(v.state)) &&
  typeof v.message === 'string' &&
  record(v.info) &&
  (v.bytes === undefined || v.bytes instanceof ArrayBuffer) &&
  (v.name === undefined || typeof v.name === 'string') &&
  (v.image === undefined ||
    (record(v.image) &&
      typeof v.image.width === 'number' &&
      typeof v.image.height === 'number' &&
      v.image.width > 0 &&
      v.image.height > 0 &&
      v.image.width * v.image.height <= 4194304 &&
      v.image.rgba instanceof ArrayBuffer &&
      v.image.rgba.byteLength === v.image.width * v.image.height * 4))
export function option(
  options: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = options[key] ?? fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid ${key}: choose ${min} through ${max}`)
  return value
}
