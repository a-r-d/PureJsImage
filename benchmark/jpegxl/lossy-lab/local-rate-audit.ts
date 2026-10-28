/** First-party offline diagnostics. No encoder decision policy. */
import { createHash } from 'node:crypto'
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
} from '../../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../../src/codecs/jpegxl-decode.ts'
import { resolveJpegXlLimits } from '../../../src/codecs/jpegxl-limits.ts'
import { decodeJpegXlJpegHfGlobal } from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { JpegXlVarDctMemoryLedger } from '../../../src/codecs/jpegxl-vardct-memory.ts'
import { prepareJpegXlVarDctLowFrequency } from '../../../src/codecs/jpegxl-vardct-render.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'

/** Read the single-channel PFM emitted by the pinned metric, including bottom-up rows. */
export function readDistanceMap(bytes: Uint8Array) {
  let offset = 0
  const line = () => {
    const begin = offset
    while (offset < bytes.length && bytes[offset] !== 10) offset++
    if (offset === bytes.length) throw new Error('Truncated PFM header')
    return new TextDecoder().decode(bytes.subarray(begin, offset++)).trim()
  }
  if (line() !== 'Pf') throw new Error('Expected scalar PFM')
  const [width, height] = line().split(/\s+/u).map(Number)
  const scale = Number(line())
  if (
    !width ||
    !height ||
    !Number.isSafeInteger(width * height) ||
    width < 1 ||
    height < 1 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isFinite(scale) ||
    scale === 0 ||
    bytes.length - offset !== width * height * 4
  )
    throw new Error('Invalid PFM extent')
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = view.getFloat32(((height - 1 - y) * width + x) * 4, scale < 0) * Math.abs(scale)
      if (!Number.isFinite(v) || v < 0) throw new Error('Invalid distance')
      values[y * width + x] = v
    }
  return { width, height, values }
}
export interface AuditWindow {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}
export function windowContrast(
  source: Float64Array,
  decoded: Float64Array,
  width: number,
  height: number,
  box: AuditWindow,
) {
  if (
    source.length !== width * height ||
    decoded.length !== source.length ||
    box.x < 0 ||
    box.y < 0 ||
    box.width < 1 ||
    box.height < 1 ||
    box.x + box.width > width ||
    box.y + box.height > height
  )
    throw new Error('Invalid contrast window')
  let s = 0,
    d = 0,
    ss = 0,
    dd = 0,
    sd = 0,
    error = 0,
    sourceGradient = 0,
    decodedGradient = 0,
    gradientError = 0
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++) {
      const p = y * width + x,
        a = source[p] ?? 0,
        b = decoded[p] ?? 0
      s += a
      d += b
      ss += a * a
      dd += b * b
      sd += a * b
      error += (a - b) ** 2
      for (let axis = 0; axis < 2; axis++) {
        const step = axis === 0 ? 1 : width
        if (
          (step === 1 && x + 1 >= box.x + box.width) ||
          (step === width && y + 1 >= box.y + box.height)
        )
          continue
        const da = (source[p + step] ?? 0) - a,
          db = (decoded[p + step] ?? 0) - b
        sourceGradient += da * da
        decodedGradient += db * db
        gradientError += (da - db) ** 2
      }
    }
  const count = box.width * box.height,
    sv = Math.max(0, ss - (s * s) / count),
    dv = Math.max(0, dd - (d * d) / count)
  return {
    sourceMean: s / count,
    decodedMean: d / count,
    sourceVariance: sv / count,
    decodedVariance: dv / count,
    contrastRatio: sv > 0 ? Math.sqrt(dv / sv) : null,
    contrastGain: sv > 0 ? (sd - (s * d) / count) / sv : null,
    squaredError: error,
    sourceGradient,
    decodedGradient,
    gradientError,
  }
}
export async function encodedSectionCosts(bytes: Uint8Array) {
  const source = new MemorySource(bytes)
  const logical = new JpegXlCodestreamSource(
    source,
    await inspectJpegXlSource(source, resolveJpegXlLimits()),
  )
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const frame = frames[0]
  if (frames.length !== 1 || !frame || frame.encoding !== 'vardct' || frame.sections.length < 3)
    throw new Error('Expected separated single VarDCT frame')
  const sections = await Promise.all(
    frame.sections.map(async (s, i) => ({
      kind:
        i === 0
          ? 'lfGlobal'
          : i <= frame.dcGroupCount
            ? 'dc'
            : i === 1 + frame.dcGroupCount
              ? 'hfGlobal'
              : 'ac',
      index: i,
      bytes: s.length,
      hash: createHash('sha256')
        .update(await logical.read(s.offset, s.length))
        .digest('hex'),
    })),
  )
  return {
    bytes: bytes.length,
    overhead: bytes.length - sections.reduce((s, r) => s + r.bytes, 0),
    sections,
  }
}

/** Inspect the signaled orders and coding model without consuming peer decisions. */
export async function inspectEntropyModel(bytes: Uint8Array) {
  const source = new MemorySource(bytes)
  const logical = new JpegXlCodestreamSource(
    source,
    await inspectJpegXlSource(source, resolveJpegXlLimits()),
  )
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const frame = frames[0]
  if (frames.length !== 1 || !frame || frame.encoding !== 'vardct' || frame.sections.length < 3)
    throw new Error('Expected separated single VarDCT frame')
  const sections = await Promise.all(frame.sections.map((s) => logical.read(s.offset, s.length)))
  const memory = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
  const state = prepareJpegXlVarDctLowFrequency(sections, frame, memory)
  try {
    const section = sections[1 + frame.dcGroupCount]
    if (!section) throw new Error('Missing HF global')
    const hf = decodeJpegXlJpegHfGlobal(
      section,
      {
        dcGroupCount: frame.dcGroupCount,
        groupCount: frame.groupsAcross * frame.groupsDown,
        passCount: frame.passCount,
      },
      state.lfGlobal,
      0,
      true,
    )
    const digest = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex')
    return {
      hfBits: hf.endingBitPosition,
      passes: hf.passes.map((pass) => ({
        orderHash: digest(pass.coefficientOrders),
        contextMapHash: digest(pass.coefficientCode.contextMap),
        configHash: digest(pass.coefficientCode.uintConfigs),
        modelHash: digest(pass.coefficientCode),
        histograms:
          pass.coefficientCode.aliasTables?.length ??
          pass.coefficientCode.huffmanCodes?.length ??
          0,
      })),
    }
  } finally {
    state.release()
  }
}
