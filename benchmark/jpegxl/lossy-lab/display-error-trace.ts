/** Offline reconstruction-stage audit using our decoder and our own streams. */
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
} from '../../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../../src/codecs/jpegxl-decode.ts'
import { resolveJpegXlLimits } from '../../../src/codecs/jpegxl-limits.ts'
import { JpegXlVarDctMemoryLedger } from '../../../src/codecs/jpegxl-vardct-memory.ts'
import {
  convertJpegXlNativeXybPlanes,
  convertJpegXlNativeXybPlanesToLinear,
  decodeJpegXlDct8Section,
  filterJpegXlModularPlanes,
} from '../../../src/codecs/jpegxl-vardct-render.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'

export type TracePlanes = readonly [Float64Array, Float64Array, Float64Array]
export const tracePlanes = (length: number): TracePlanes => [
  new Float64Array(length),
  new Float64Array(length),
  new Float64Array(length),
]

export function traceSquaredError(a: TracePlanes, b: TracePlanes): number[] {
  if (a.some((p, c) => p.length !== b[c]?.length)) throw new Error('Trace extents differ')
  const sums = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const x = a[c],
      y = b[c]
    if (!x || !y) throw new Error('Missing trace channel')
    let sum = 0
    for (let p = 0; p < x.length; p++) sum += ((x[p] ?? 0) - (y[p] ?? 0)) ** 2
    sums[c] = sum
  }
  return sums
}

/** E_after = E_before + correction energy + 2*cross. Cross measures cancellation. */
export function traceCorrection(before: TracePlanes, after: TracePlanes, reference: TracePlanes) {
  const error = traceSquaredError(before, reference)
  const corrected = traceSquaredError(after, reference)
  const correction = traceSquaredError(after, before)
  return {
    before: error,
    after: corrected,
    correction,
    cross: corrected.map((v, c) => (v - (error[c] ?? 0) - (correction[c] ?? 0)) / 2),
  }
}

export async function decodeDisplayStages(bytes: Uint8Array, idealRaw?: TracePlanes) {
  const source = new MemorySource(bytes)
  const structure = await inspectJpegXlSource(source, resolveJpegXlLimits())
  const logical = new JpegXlCodestreamSource(source, structure)
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const frame = frames[0]
  if (frames.length !== 1 || !frame || frame.encoding !== 'vardct' || frame.upsampling !== 1)
    throw new Error('Trace requires a single full-resolution VarDCT frame')
  if (idealRaw?.some((plane) => plane.length !== frame.width * frame.height))
    throw new Error('Ideal trace extents differ')
  const sections = await Promise.all(frame.sections.map((s) => logical.read(s.offset, s.length)))
  const first = sections[0]
  if (!first) throw new Error('Missing trace section')
  const stages: TracePlanes[] = []
  for (const stage of ['raw', 'gaborish', 'epf'] as const) {
    const current = {
      ...frame,
      gaborish: stage !== 'raw' && frame.gaborish,
      epfIterations: stage === 'epf' ? frame.epfIterations : 0,
    }
    const memory = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
    const result = decodeJpegXlDct8Section(
      first,
      current,
      defaultImageLimits,
      memory,
      sections.length > 1 ? sections.slice(1) : undefined,
      undefined,
      true,
    )
    try {
      if (!result.dcPlanes) throw new Error('Missing native reconstruction planes')
      stages.push([
        result.dcPlanes[0].slice(),
        result.dcPlanes[1].slice(),
        result.dcPlanes[2].slice(),
      ])
    } finally {
      result.release()
    }
  }
  const raw = stages[0],
    gaborish = stages[1],
    epf = stages[2]
  if (!raw || !gaborish || !epf) throw new Error('Missing display stage')
  const idealGaborish = idealRaw
    ? ([idealRaw[0].slice(), idealRaw[1].slice(), idealRaw[2].slice()] as const)
    : undefined
  if (idealGaborish)
    filterJpegXlModularPlanes(idealGaborish, { ...frame, colorChannels: 3, epfIterations: 0 })
  const linear = convertJpegXlNativeXybPlanesToLinear(epf, frame.opsinInverse)
  const srgb = convertJpegXlNativeXybPlanes(epf, frame.opsinInverse)
  const rounded = tracePlanes(frame.width * frame.height)
  for (let c = 0; c < 3; c++) {
    const input = srgb[c],
      target = rounded[c]
    if (!input || !target) throw new Error('Missing display channel')
    for (let p = 0; p < input.length; p++)
      target[p] = Math.round(Math.max(0, Math.min(1, input[p] ?? 0)) * 255) / 255
  }
  return {
    raw,
    gaborish,
    epf,
    idealGaborish,
    linear,
    srgb,
    rounded,
    width: frame.width,
    height: frame.height,
    epfIterations: frame.epfIterations,
  }
}
