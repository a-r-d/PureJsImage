import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import generatedVarDct from './generated-vardct-manifest.json' with { type: 'json' }
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { estimateJpegXlVarDctWorkingMemory } from '../../src/codecs/jpegxl-vardct-memory.ts'
import { ImageError } from '../../src/errors.ts'
import { createEvidenceSession, type EvidenceMode } from '../../src/evidence.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

type Workload =
  | 'gaborish-epf'
  | 'noise'
  | 'progressive'
  | 'large-single-group'
  | 'large-preflight-rejection'
  | 'evidence-off'
  | 'evidence-summary'
  | 'evidence-trace'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

const snapshot = (): MemorySnapshot => {
  const memory = process.memoryUsage()
  return Object.freeze({
    arrayBuffersBytes: memory.arrayBuffers,
    externalBytes: memory.external,
    heapUsedBytes: memory.heapUsed,
    rssBytes: memory.rss,
  })
}

const maximum = (left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot =>
  Object.freeze({
    arrayBuffersBytes: Math.max(left.arrayBuffersBytes, right.arrayBuffersBytes),
    externalBytes: Math.max(left.externalBytes, right.externalBytes),
    heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
    rssBytes: Math.max(left.rssBytes, right.rssBytes),
  })

const pnmPixels = (data: Uint8Array): Uint8Array => {
  let offset = 0
  let tokens = 0
  while (offset < data.byteLength && tokens < 4) {
    while (offset < data.byteLength && (data[offset] ?? 0) <= 0x20) offset += 1
    if (data[offset] === 0x23) {
      while (offset < data.byteLength && data[offset] !== 0x0a) offset += 1
      continue
    }
    while (offset < data.byteLength && (data[offset] ?? 0) > 0x20) offset += 1
    tokens += 1
  }
  if (tokens !== 4 || offset >= data.byteLength) throw new Error('PNM header is invalid')
  return data.subarray(offset + 1)
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const configuration = (
  workload: Workload,
): Readonly<{ fixtureId: string; evidence?: EvidenceMode }> => {
  if (workload === 'progressive') return Object.freeze({ fixtureId: 'rgb8-distance2-progressive' })
  if (workload === 'large-single-group' || workload === 'large-preflight-rejection') {
    return Object.freeze({ fixtureId: 'rgb8-distance1-single-group-255' })
  }
  if (workload === 'gaborish-epf') return Object.freeze({ fixtureId: 'rgb8-distance1-effort1' })
  if (workload === 'evidence-summary') {
    return Object.freeze({ fixtureId: 'rgb8-distance4-noise', evidence: 'summary' })
  }
  if (workload === 'evidence-trace') {
    return Object.freeze({ fixtureId: 'rgb8-distance4-noise', evidence: 'trace' })
  }
  return Object.freeze({ fixtureId: 'rgb8-distance4-noise' })
}

const workload = process.argv[2] as Workload | undefined
const workloads: readonly Workload[] = Object.freeze([
  'gaborish-epf',
  'noise',
  'progressive',
  'large-single-group',
  'large-preflight-rejection',
  'evidence-off',
  'evidence-summary',
  'evidence-trace',
])
if (!workload || !workloads.includes(workload)) {
  throw new Error(`Usage: vardct-memory-worker.ts <${workloads.join('|')}>`)
}
const selected = configuration(workload)
const fixture = generatedVarDct.fixtures.find(({ id }) => id === selected.fixtureId)
if (!fixture) throw new Error(`VarDCT memory fixture ${selected.fixtureId} is missing`)
const input = new Uint8Array(await readFile(fixture.jxl))
const oracle = pnmPixels(new Uint8Array(await readFile(fixture.oracle)))
if (
  sha256(input) !== fixture.jxlSha256 ||
  sha256(new Uint8Array(await readFile(fixture.oracle))) !== fixture.oracleSha256
) {
  throw new Error('VarDCT memory fixture checksum changed')
}
const frames = await readJpegXlSourceFrameStructures(new MemorySource(input), defaultImageLimits)
const frame = frames.at(-1)
if (!frame) throw new Error('VarDCT memory fixture has no display frame')
const estimate = estimateJpegXlVarDctWorkingMemory(frame)
if (estimate.requiredBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
  throw new Error('VarDCT memory preflight exceeds the JavaScript safe integer range')
}
for (let turn = 0; turn < 5; turn += 1) {
  globalThis.gc?.()
  await new Promise<void>((resolve) => setImmediate(resolve))
}
const baseline = snapshot()
let peak = baseline
const startedAt = performance.now()
const evidence = selected.evidence ? createEvidenceSession({ mode: selected.evidence }) : undefined

if (workload === 'large-preflight-rejection') {
  const rejectedLimit = Number(estimate.requiredBytes - 1n)
  let rejectionCode: string | undefined
  try {
    await jpegxlCodec.createDecoder?.(new MemorySource(input), {
      ...defaultImageLimits,
      maxDecodedBytes: rejectedLimit,
    })
  } catch (error) {
    rejectionCode = error instanceof ImageError ? error.code : undefined
  }
  if (rejectionCode !== 'LIMIT_EXCEEDED') {
    throw new Error('Large selected VarDCT preflight did not reject with LIMIT_EXCEEDED')
  }
  console.log(
    JSON.stringify({
      workload,
      fixtureId: fixture.id,
      validation: 'preflight-rejection',
      baseline,
      peak: maximum(peak, snapshot()),
      maximumRssBytes: process.resourceUsage().maxRSS * 1_024,
      inputBytes: input.byteLength,
      inputSha256: sha256(input),
      outputBytes: 0,
      outputSha256: '',
      maximumError: 0,
      rmse: 0,
      managedPeakBytes: 0,
      preflightBytes: Number(estimate.requiredBytes),
      evidenceMode: 'off',
      evidencePeakBytes: 0,
      evidenceCurrentBytes: 0,
      rejectionCode,
      wallMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
    }),
  )
  process.exit(0)
}

const decoder = await jpegxlCodec.createDecoder?.(
  new MemorySource(input),
  defaultImageLimits,
  evidence ? { evidence: evidence.context } : {},
)
if (!decoder) throw new Error('JPEG XL VarDCT decoder is unavailable')
peak = maximum(peak, snapshot())
const digest = createHash('sha256')
let outputBytes = 0
let maximumError = 0
let squaredError = 0
for await (const block of decoder.decode()) {
  const expectedOffset = block.y * fixture.width * (decoder.pixelFormat === 'gray8' ? 1 : 3)
  for (let index = 0; index < block.data.byteLength; index += 1) {
    const difference = Math.abs((block.data[index] ?? 0) - (oracle[expectedOffset + index] ?? 0))
    maximumError = Math.max(maximumError, difference)
    squaredError += difference * difference
  }
  digest.update(block.data)
  outputBytes += block.data.byteLength
  peak = maximum(peak, snapshot())
  block.release?.()
}
if (outputBytes !== oracle.byteLength) throw new Error('VarDCT memory output length is invalid')
const rmse = Math.sqrt(squaredError / outputBytes)
if (maximumError > 1 || rmse >= 0.5) {
  throw new Error(`VarDCT memory output exceeds max error/RMSE: ${maximumError}/${rmse}`)
}
const managedPeakBytes =
  'managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number'
    ? decoder.managedPeakBytes
    : 0
if (managedPeakBytes < 1) throw new Error('VarDCT decoder did not report a managed peak')
const report = evidence?.finalize()
if (
  report &&
  (report.managedMemory.currentLiveBytes !== 0 || report.managedMemory.stillLiveLeases !== 0)
) {
  throw new Error('VarDCT evidence retained managed allocations after decode')
}
console.log(
  JSON.stringify({
    workload,
    fixtureId: fixture.id,
    validation: 'tolerance-pixels',
    baseline,
    peak,
    maximumRssBytes: process.resourceUsage().maxRSS * 1_024,
    inputBytes: input.byteLength,
    inputSha256: sha256(input),
    outputBytes,
    outputSha256: digest.digest('hex'),
    maximumError,
    rmse,
    managedPeakBytes,
    preflightBytes: Number(estimate.requiredBytes),
    evidenceMode: selected.evidence ?? 'off',
    evidencePeakBytes: report?.managedMemory.peakLiveBytes ?? 0,
    evidenceCurrentBytes: report?.managedMemory.currentLiveBytes ?? 0,
    wallMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
  }),
)
