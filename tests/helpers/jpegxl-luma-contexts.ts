import {
  encodeVarDctCoefficientSections,
  encodeVarDctCoefficientSectionsAsync,
  varDctCodestreamParts,
  type VarDctCoefficientGeometry,
} from '../../src/codecs/jpegxl-jpeg-encode.ts'
import {
  JpegXlEncoderMemory,
  withJpegXlMemory,
  withJpegXlMemoryAsync,
} from '../../src/codecs/jpegxl-encoder-memory.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { invalidInput, limitExceeded } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

type Failure =
  | 'none'
  | 'limit'
  | 'invalid'
  | 'cancel'
  | 'group-limit'
  | 'group-invalid'
  | 'group-cancel'
type Owned = ReturnType<JpegXlEncoderMemory['allocate']>
const invalid = invalidInput('Deliberate luma-context allocation failure')
const cancelled = new Error('Deliberate luma-context cancellation')

const checksum = (data: ArrayLike<number>, initial = 2166136261): number => {
  let value = initial
  for (let at = 0; at < data.length; at++)
    value = Math.imul(value ^ (data[at] ?? 0), 16777619) >>> 0
  return value
}

class LumaMemory extends JpegXlEncoderMemory {
  hits = 0
  groupHits = 0
  candidateHistograms = 0
  readonly blocks: number
  readonly failure: Failure
  constructor(blocks: number, failure: Failure) {
    super(67_108_864)
    this.blocks = blocks
    this.failure = failure
  }
  override allocate<T extends Owned>(
    arrayType: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
    length: number,
    scope = this.currentScope,
  ): T {
    if (Object.is(arrayType, Int32Array) && length === this.blocks) {
      this.hits++
      if (this.failure === 'limit') throw limitExceeded('Deliberate luma-context memory limit')
      if (this.failure === 'invalid') throw invalid
    }
    if (this.hits === 2 && Object.is(arrayType, Uint32Array) && length === 512) {
      // The first 512-bin allocation belongs to the existing Modular header.
      // The next allocation starts the optional group-training histograms.
      this.candidateHistograms++
      if (this.candidateHistograms === 1) return super.allocate(arrayType, length, scope)
      this.groupHits++
      if (this.failure === 'group-limit')
        throw limitExceeded('Deliberate group-context memory limit')
      if (this.failure === 'group-invalid') throw invalid
    }
    return super.allocate(arrayType, length, scope)
  }
}

export const verifyJpegXlLumaContexts = async (
  asynchronous: boolean,
  failure: Failure = 'none',
  eligible = true,
  effort: 7 | 9 = 9,
  blockDimensions?: readonly [number, number],
) => {
  const across = blockDimensions?.[0] ?? (eligible ? 257 : 256),
    down = blockDimensions?.[1] ?? 256,
    blocks = across * down
  const width = across * 8 - 3,
    height = down * 8 - 1
  const dc = Array.from({ length: 3 }, (_, channel) => ({
    blocksPerLineForMcu: across,
    blocksPerColumnForMcu: down,
    coefficientStride: 1 as const,
    coefficients: Int32Array.from({ length: blocks }, (_, block) =>
      channel === 0 ? 400 + (block % 97) : 0,
    ),
  }))
  const before = dc.map((plane) => checksum(plane.coefficients))
  const scratch = Array.from({ length: 3 }, () => new Int32Array(32 * 32 * 64))
  const alpha = new Int32Array(256 * 256)
  const alphaPalette = Uint8Array.of(0, 128, 255)
  const alphaAt = (x: number, y: number): number => alphaPalette[((x >>> 4) + (y >>> 4)) % 3] ?? 0
  // A 65536-element probe also counts ordinary alpha scratch. Keep the legacy
  // effort-7 control probe, and use an odd block count for the new effort-9 case.
  const memory = new LumaMemory(
    blockDimensions ? blocks : effort === 7 ? 257 * 256 : blocks,
    failure,
  )
  const geometry: VarDctCoefficientGeometry = {
    colorTransform: 'xyb',
    chromaSubsampling: [0, 0, 0],
    shifts: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    blocksWide: across,
    blocksHigh: down,
    groupsAcross: Math.ceil(across / 32),
    groupsDown: Math.ceil(down / 32),
    dcAcross: Math.ceil(across / 256),
    dcDown: Math.ceil(down / 256),
    acComponents: [],
    dcComponents: dc,
    quantization: Array.from({ length: 3 }, () => new Int32Array(64).fill(1)),
    dcQuantization: [1 / 8192, 1 / 1024, 1 / 512],
    defaultMatrices: true,
    globalScale: 8192,
    quantAc: 4,
    quantDc: 4,
    baseB: 1,
    effort,
    acIterationSearch: effort === 9,
    memory,
    alpha: {
      loadGroup: (group) => {
        const x = (group % Math.ceil(across / 32)) * 256
        const y = Math.floor(group / Math.ceil(across / 32)) * 256
        const groupWidth = Math.min(256, width - x),
          groupHeight = Math.min(256, height - y)
        for (let row = 0; row < groupHeight; row++)
          for (let col = 0; col < groupWidth; col++)
            alpha[row * groupWidth + col] = alphaAt(x + col, y + row)
        return {
          width: groupWidth,
          height: groupHeight,
          values: alpha.subarray(0, groupWidth * groupHeight),
        }
      },
    },
    loadAc: (group) => {
      const x = (group % Math.ceil(across / 32)) * 32,
        y = Math.floor(group / Math.ceil(across / 32)) * 32
      const groupWidth = Math.min(32, across - x),
        groupHeight = Math.min(32, down - y)
      return scratch.map((coefficients, channel) => {
        coefficients.fill(0)
        if (channel === 1)
          for (let row = 0; row < groupHeight; row++)
            for (let col = 0; col < groupWidth; col++) {
              const block = (y + row) * across + x + col
              coefficients[(row * groupWidth + col) * 64 + 1] =
                block % 97 <= 48 ? 1 : 20 + (block % 17)
            }
        return {
          blocksPerLineForMcu: groupWidth,
          blocksPerColumnForMcu: groupHeight,
          coefficients: coefficients.subarray(0, groupWidth * groupHeight * 64),
        }
      })
    },
  }
  const assemble = (sections: readonly Uint8Array[]): Uint8Array => {
    const parts = varDctCodestreamParts({ width, height }, geometry, sections)
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
      bytes.set(part, at)
      at += part.length
    }
    return bytes
  }
  let encoded: Uint8Array | undefined, error: unknown
  try {
    encoded = asynchronous
      ? await withJpegXlMemoryAsync(memory, async () =>
          assemble(
            await encodeVarDctCoefficientSectionsAsync(geometry, async () => {
              if (
                (failure === 'cancel' && memory.hits > 0) ||
                (failure === 'group-cancel' && memory.groupHits > 0)
              )
                throw cancelled
            }),
          ),
        )
      : withJpegXlMemory(memory, () => assemble(encodeVarDctCoefficientSections(geometry)))
  } catch (caught) {
    error = caught
  }
  const callerPreserved = dc.every((plane, index) => checksum(plane.coefficients) === before[index])
  const live = memory.liveBytes,
    allocations = memory.liveAllocations,
    peak = memory.peakBytes,
    hits = memory.hits,
    groupHits = memory.groupHits
  memory.close()
  if (!callerPreserved || live !== 0 || allocations !== 0)
    throw new Error('Luma-context caller or ownership changed')
  if (
    failure === 'invalid' ||
    failure === 'cancel' ||
    failure === 'group-invalid' ||
    failure === 'group-cancel'
  ) {
    const grouped = failure === 'group-invalid' || failure === 'group-cancel'
    if (
      encoded ||
      error !== (failure === 'invalid' || failure === 'group-invalid' ? invalid : cancelled) ||
      hits !== (grouped ? 2 : 1) ||
      (grouped && groupHits < 1)
    )
      throw new Error('Optional luma-context error swallowed', { cause: error })
    return {
      bytes: 0,
      encodedChecksum: 0,
      decodedChecksum: 0,
      alphaError: 0,
      colorMinimum: 0,
      colorMaximum: 0,
      samples: 0,
      propagated: true,
      callerPreserved,
      live,
      allocations,
      peak,
      hits,
      groupHits,
    }
  }
  if (error || !encoded) throw new Error('Luma-context encoding failed', { cause: error })
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgba8'
  )
    throw new Error('Luma-context decoded layout changed')
  let rows = 0,
    decodedChecksum = 2166136261,
    samples = 0,
    alphaError = 0,
    colorMinimum = 255,
    colorMaximum = 0
  for await (const block of decoder.decode()) {
    try {
      if (block.x !== 0 || block.y !== rows || block.width !== width || block.format !== 'rgba8')
        throw new Error('Luma-context rows changed')
      for (let row = 0; row < block.height; row++) {
        const data = block.data.subarray(row * block.stride, row * block.stride + width * 4)
        for (let x = 0; x < width; x++)
          alphaError = Math.max(
            alphaError,
            Math.abs((data[x * 4 + 3] ?? -1) - alphaAt(x, block.y + row)),
          )
        for (let at = 0; at < data.length; at += 4)
          for (let channel = 0; channel < 3; channel++) {
            const value = data[at + channel] ?? 0
            colorMinimum = Math.min(colorMinimum, value)
            colorMaximum = Math.max(colorMaximum, value)
          }
        decodedChecksum = checksum(data, decodedChecksum)
        samples += data.length
      }
      rows += block.height
    } finally {
      block.release?.()
    }
  }
  if (rows !== height || samples !== width * height * 4)
    throw new Error('Luma-context output incomplete')
  return {
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    decodedChecksum,
    alphaError,
    colorMinimum,
    colorMaximum,
    samples,
    propagated: false,
    callerPreserved,
    live,
    allocations,
    peak,
    hits,
    groupHits,
  }
}
