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
import { extractDevelopmentReferences } from './feature-transplant.ts'

/** Development-only inspection through the first-party decoder, without native probes. */
export async function extractDecisions(bytes: Uint8Array, includeReferences = false) {
  const source = new MemorySource(bytes)
  const limits = resolveJpegXlLimits()
  const structure = await inspectJpegXlSource(source, limits)
  const logical = new JpegXlCodestreamSource(source, structure)
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const frame = frames.at(-1)
  if (!frame || frame.frameType !== 'regular' || frame.encoding !== 'vardct')
    throw new Error('Decision transplant requires a final VarDCT frame')
  const sections = await Promise.all(frame.sections.map((s) => logical.read(s.offset, s.length)))
  const memory = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
  const state = prepareJpegXlVarDctLowFrequency(sections, frame, memory)
  try {
    const global = state.lfGlobal
    const dc = state.dcGroup
    const separated = sections.length > 1
    const hfSection = sections[separated ? 1 + frame.dcGroupCount : 0]
    if (!hfSection) throw new Error('Missing HF global')
    const hf = decodeJpegXlJpegHfGlobal(
      hfSection,
      {
        dcGroupCount: frame.dcGroupCount,
        groupCount: frame.groupsAcross * frame.groupsDown,
        passCount: frame.passCount,
      },
      global,
      separated ? 0 : dc.endingBitPosition,
      separated,
    )
    return {
      width: frame.width,
      height: frame.height,
      dependencies: frames.slice(0, -1).map((f) => ({
        frameType: f.frameType,
        encoding: f.encoding,
        width: f.width,
        height: f.height,
        saveAsReference: f.saveAsReference,
        saveBeforeColorTransform: f.saveBeforeColorTransform,
        sectionBytes: f.sections.reduce((n, s) => n + s.length, 0),
      })),
      ...(includeReferences ? { references: await extractDevelopmentReferences(bytes) } : {}),
      blocksWide: dc.blockWidth,
      blocksHigh: dc.blockHeight,
      strategies: Array.from(dc.strategies),
      strategyFirstBlocks: Array.from(dc.strategyFirstBlocks),
      rawQuantization: Array.from(dc.quantization),
      globalScale: global.globalScale,
      quantDc: global.quantDc,
      dcQuantization: global.dcQuantization,
      colorCorrelation: global.colorCorrelation,
      correlationX: Array.from(dc.colorCorrelationX),
      correlationB: Array.from(dc.colorCorrelationB),
      sharpness: Array.from(dc.sharpness),
      gaborish: frame.gaborish,
      epfIterations: frame.epfIterations,
      gaborishWeights: frame.gaborishWeights ?? null,
      epfSharpness: frame.epfSharpness ?? null,
      epfWeights: frame.epfWeights ?? null,
      epfSigma: frame.epfSigma ?? null,
      patches: global.patches,
      noise: global.noiseLut ?? null,
      splines: global.splines,
      splineQuantizationAdjustment: global.splineQuantizationAdjustment,
      xQuantizationScale: frame.xQuantizationScale,
      bQuantizationScale: frame.bQuantizationScale,
      smoothDc: (frame.frameFlags & 128) === 0,
      quantizationTables: hf.quantizationTables.map((t) => t?.map((p) => Array.from(p)) ?? null),
      dcExtraPrecision: dc.extraPrecision,
      passCount: frame.passCount,
    }
  } finally {
    state.release()
  }
}

export type TransplantDecisions = Awaited<ReturnType<typeof extractDecisions>>
