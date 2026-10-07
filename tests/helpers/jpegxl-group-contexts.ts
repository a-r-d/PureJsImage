import { JpegXlBitReader } from '../../src/codecs/jpegxl-bitstream.ts'
import { JpegXlCodestreamSource, inspectJpegXlSource } from '../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import {
  JpegXlEncoderMemory,
  withJpegXlMemory,
  withJpegXlMemoryAsync,
} from '../../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeVarDctCoefficientSections,
  encodeVarDctCoefficientSectionsAsync,
  varDctCodestreamParts,
  type VarDctCoefficientGeometry,
} from '../../src/codecs/jpegxl-jpeg-encode.ts'
import { resolveJpegXlLimits } from '../../src/codecs/jpegxl-limits.ts'
import {
  decodeJpegXlJpegAcGroup,
  decodeJpegXlJpegHfGlobal,
} from '../../src/codecs/jpegxl-vardct-jpeg.ts'
import { JpegXlVarDctMemoryLedger } from '../../src/codecs/jpegxl-vardct-memory.ts'
import { prepareJpegXlVarDctLowFrequency } from '../../src/codecs/jpegxl-vardct-render.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource, readExactly } from '../../src/source.ts'

const checksum = (data: ArrayLike<number>): number => {
  let value = 2166136261
  for (let at = 0; at < data.length; at++)
    value = Math.imul(value ^ (data[at] ?? 0), 16777619) >>> 0
  return value
}

export const verifyJpegXlGroupContexts = async (asynchronous: boolean) => {
  const results = []
  for (const across of [35, 64])
    for (const threshold of [undefined, 1]) {
      const down = 33,
        width = across * 8 - 3,
        height = down * 8 - 1
      const memory = new JpegXlEncoderMemory(268_435_456)
      const dc = Array.from({ length: 3 }, (_, channel) => ({
        blocksPerLineForMcu: across,
        blocksPerColumnForMcu: down,
        coefficientStride: 1 as const,
        coefficients: Int32Array.from({ length: across * down }, (_, block) =>
          channel === 0 ? block % 3 : 0,
        ),
      }))
      const before = dc.map((plane) => checksum(plane.coefficients))
      const scratch = Array.from({ length: 3 }, () => new Int32Array(32 * 32 * 64))
      const coefficient = (
        group: number,
        channel: number,
        block: number,
        position: number,
      ): number => {
        if (position !== 1 && position !== 8 && position !== 63) return 0
        if (group === 0) return channel === 1 && position === 1 ? 1 : 0
        if (group === 1) return position === 1 ? (channel + 1) * 11 : 0
        if (group === 2) return position === 8 ? -((block % 17) + channel + 1) : 0
        return position === 63 ? 100 + (block % 7) + channel : 0
      }
      const geometry: VarDctCoefficientGeometry = {
        colorTransform: 'xyb',
        chromaSubsampling: [0, 0, 0],
        shifts: [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        fullBlockWidth: across,
        fullBlockHeight: down,
        groupsAcross: 2,
        groupsDown: 2,
        dcGroupsAcross: 1,
        dcGroupsDown: 1,
        internalComponents: [],
        dcPlaneComponents: dc,
        quantization: Array.from({ length: 3 }, () => new Int32Array(64).fill(1)),
        dcQuantization: [1 / 8192, 1 / 1024, 1 / 512],
        defaultQuantization: true,
        globalScale: 8192,
        blockQuantization: 4,
        quantDc: 4,
        baseCorrelationB: 1,
        effort: 7,
        forwardAcIterationSearch: true,
        forwardGroupContexts: true,
        ...(threshold === undefined ? {} : { forwardLumaThreshold: threshold }),
        memory,
        loadAcGroup: (group) => {
          const w = Math.min(32, across - (group % 2) * 32),
            h = Math.min(32, down - Math.floor(group / 2) * 32)
          return scratch.map((coefficients, channel) => {
            coefficients.fill(0)
            for (let block = 0; block < w * h; block++)
              for (const p of [1, 8, 63])
                coefficients[block * 64 + (p & 7) * 8 + (p >>> 3)] = coefficient(
                  group,
                  channel,
                  block,
                  p,
                )
            return {
              blocksPerLineForMcu: w,
              blocksPerColumnForMcu: h,
              coefficients: coefficients.subarray(0, w * h * 64),
            }
          })
        },
      }
      const assemble = (sections: readonly Uint8Array[]): Uint8Array => {
        const parts = varDctCodestreamParts({ width, height }, geometry, sections)
        const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
        let at = 0
        for (const part of parts) {
          output.set(part, at)
          at += part.length
        }
        return output
      }
      const encoded = asynchronous
        ? await withJpegXlMemoryAsync(memory, async () =>
            assemble(await encodeVarDctCoefficientSectionsAsync(geometry, async () => {})),
          )
        : withJpegXlMemory(memory, () => assemble(encodeVarDctCoefficientSections(geometry)))
      const live = memory.liveBytes,
        allocations = memory.liveAllocations,
        peak = memory.peakBytes
      memory.close()
      const callerPreserved = dc.every(
        (plane, channel) => checksum(plane.coefficients) === before[channel],
      )
      if (live !== 0 || allocations !== 0 || !callerPreserved)
        throw new Error('Spatial context ownership or caller changed')
      const physical = new MemorySource(encoded),
        structure = await inspectJpegXlSource(physical, resolveJpegXlLimits())
      const logical = new JpegXlCodestreamSource(physical, structure)
      const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits),
        frame = frames.at(-1)
      if (!frame || frame.dcGroupCount !== 1 || frame.encoding !== 'vardct')
        throw new Error('Spatial context frame differs')
      const sections = await Promise.all(
        frame.sections.map((section) => readExactly(logical, section.offset, section.length)),
      )
      const ledger = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
      const state = prepareJpegXlVarDctLowFrequency(sections.slice(0, 2), frame, ledger)
      try {
        const hfBytes = sections[2]
        if (!hfBytes) throw new Error('Spatial HF metadata missing')
        const hf = decodeJpegXlJpegHfGlobal(
          hfBytes,
          { dcGroupCount: 1, groupCount: 4, passCount: 1 },
          state.lfGlobal,
          0,
          true,
        )
        if (hf.histogramCount < 2 || hf.histogramCount > 4)
          throw new Error('Multiple spatial histograms required')
        const pass = hf.passes[0]
        if (
          !pass ||
          pass.coefficientCode.contextMap.length !==
            hf.histogramCount * state.lfGlobal.blockContexts.contextCount * (37 + 458)
        )
          throw new Error('Spatial context extent differs')
        const selectors: number[] = []
        let samples = 0
        for (let group = 0; group < 4; group++) {
          const section = sections[3 + group]
          if (!section) throw new Error('Spatial group missing')
          const selector = new JpegXlBitReader(section).readBits(
            Math.ceil(Math.log2(hf.histogramCount)),
          )
          if (selector >= hf.histogramCount) throw new Error('Spatial selector outside its bound')
          selectors.push(selector)
          const x = (group % 2) * 32,
            y = Math.floor(group / 2) * 32
          const w = Math.min(32, across - x),
            h = Math.min(32, down - y)
          const decoded = decodeJpegXlJpegAcGroup(
            section,
            {
              blockX: x,
              blockY: y,
              blockWidth: w,
              blockHeight: h,
              chromaSubsampling: [0, 0, 0],
              histogramCount: hf.histogramCount,
              colorTransform: 'none',
            },
            state.lfGlobal,
            pass,
            state.dcGroup,
            0,
            true,
            false,
          )
          for (let channel = 0; channel < 3; channel++) {
            const values = decoded.vardctCoefficientArenas[channel]
            if (!values || values.length !== w * h * 64)
              throw new Error('Spatial coefficient arena differs')
            for (let block = 0; block < w * h; block++) {
              const offset = decoded.vardctCoefficientOffsets[block]
              if (offset === undefined || offset < 0 || offset + 64 > values.length)
                throw new Error('Spatial coefficient offset differs')
              for (let position = 1; position < 64; position++) {
                if (values[offset + position] !== coefficient(group, channel, block, position))
                  throw new Error('Spatial coefficient changed')
                samples++
              }
            }
          }
        }
        if (new Set(selectors).size < 2) throw new Error('Multiple spatial selectors required')
        results.push({
          across,
          threshold: threshold ?? null,
          bytes: encoded.length,
          encodedChecksum: checksum(encoded),
          histogramCount: hf.histogramCount,
          contextCount: pass.coefficientCode.contextMap.length,
          selectors,
          samples,
          callerPreserved,
          live,
          allocations,
          peak,
        })
      } finally {
        state.release()
      }
    }
  return results
}
