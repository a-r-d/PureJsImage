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
import { invalidInput, limitExceeded } from '../../src/errors.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

type Owned = ReturnType<JpegXlEncoderMemory['allocate']>
type FailureMode = 'none' | 'limit' | 'invalid' | 'cancel'
const invalid = invalidInput('Deliberate optional AC entropy failure')
const cancelled = new Error('Deliberate optional AC entropy cancellation')

class EntropyMemory extends JpegXlEncoderMemory {
  hits = 0
  readonly failure: FailureMode
  constructor(failure: FailureMode) {
    super(16_777_216)
    this.failure = failure
  }
  override allocate<T extends Owned>(
    arrayType: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
    length: number,
    scope = this.currentScope,
  ): T {
    if (Object.is(arrayType, Uint32Array) && length === 8192) {
      this.hits++
      if (this.failure === 'limit') throw limitExceeded('Deliberate optional AC histogram limit')
      if (this.failure === 'invalid') throw invalid
    }
    return super.allocate(arrayType, length, scope)
  }
}

const checksum = (data: ArrayLike<number>): number => {
  let result = 2166136261
  for (let at = 0; at < data.length; at++)
    result = Math.imul(result ^ (data[at] ?? 0), 16777619) >>> 0
  return result
}

const assemble = (parts: readonly Uint8Array[]): Uint8Array => {
  const encoded = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    encoded.set(part, at)
    at += part.length
  }
  return encoded
}

export const verifyCoefficientEntropyFloor = async (
  asynchronous: boolean,
  refined: boolean,
  failure: FailureMode = 'none',
) => {
  const width = 513,
    height = 129,
    blocksAcross = Math.ceil(width / 8),
    blocksDown = Math.ceil(height / 8)
  const components = Array.from({ length: 3 }, (_, channel) => {
    const coefficients = new Int32Array(blocksAcross * blocksDown * 64)
    for (let block = 0; block < blocksAcross * blocksDown; block++) {
      const base = block * 64
      coefficients[base] = channel === 1 ? 400 + ((block * 13) % 97) : 0
      for (let position = 1; position < 64; position++) {
        const magnitude =
          ((block * 7 + position * 11 + channel * 17) % 23) * (position < 10 ? 3 : 1)
        coefficients[base + position] =
          position < 25 && block % 5 !== 0
            ? ((block + position + channel) & 1) === 0
              ? magnitude
              : -magnitude
            : 0
      }
    }
    return { blocksPerLineForMcu: blocksAcross, blocksPerColumnForMcu: blocksDown, coefficients }
  })
  const [first, second, third] = components
  if (!first || !second || !third) throw new Error('Missing coefficient fixture channel')
  const callerChecksums = components.map((component) => checksum(component.coefficients))
  const alphaGroups = Array.from({ length: Math.ceil(width / 256) }, (_, group) => {
    const groupWidth = Math.min(256, width - group * 256)
    return { width: groupWidth, height, values: new Int32Array(groupWidth * height).fill(255) }
  })
  const alphaChecksums = alphaGroups.map((plane) => checksum(plane.values))
  const memory = new EntropyMemory(failure)
  const geometry: VarDctCoefficientGeometry = {
    colorTransform: 'xyb',
    chromaSubsampling: [0, 0, 0],
    shifts: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    blocksWide: blocksAcross,
    blocksHigh: blocksDown,
    groupsAcross: Math.ceil(blocksAcross / 32),
    groupsDown: Math.ceil(blocksDown / 32),
    dcAcross: 1,
    dcDown: 1,
    acComponents: components,
    dcComponents: [second, first, third],
    quantization: Array.from({ length: 3 }, () => new Int32Array(64).fill(1)),
    dcQuantization: [1 / 8192, 1 / 1024, 1 / 512],
    defaultMatrices: true,
    globalScale: 8192,
    quantAc: 4,
    quantDc: 4,
    baseB: 1,
    effort: 9,
    alpha: {
      loadGroup: (group) => {
        const plane = alphaGroups[group]
        if (!plane) throw new Error('Missing coefficient alpha group')
        return plane
      },
    },
    acIterationSearch: refined,
    memory,
  }
  let encoded: Uint8Array | undefined, error: unknown
  try {
    encoded = asynchronous
      ? await withJpegXlMemoryAsync(memory, async () => {
          const sections = await encodeVarDctCoefficientSectionsAsync(geometry, async () => {
            if (failure === 'cancel' && memory.hits > 0) throw cancelled
          })
          return assemble(varDctCodestreamParts({ width, height }, geometry, sections))
        })
      : withJpegXlMemory(memory, () =>
          assemble(
            varDctCodestreamParts(
              { width, height },
              geometry,
              encodeVarDctCoefficientSections(geometry),
            ),
          ),
        )
  } catch (caught) {
    error = caught
  }
  const callerPreserved =
    components.every(
      (component, index) => checksum(component.coefficients) === callerChecksums[index],
    ) && alphaGroups.every((plane, index) => checksum(plane.values) === alphaChecksums[index])
  const ownedLive = memory.liveBytes,
    ownedAllocations = memory.liveAllocations,
    ownedPeak = memory.peakBytes
  memory.close()
  if (!callerPreserved || ownedLive !== 0 || ownedAllocations !== 0)
    throw new Error('Coefficient caller or ownership changed')
  if (failure === 'invalid' || failure === 'cancel') {
    if (encoded || error !== (failure === 'invalid' ? invalid : cancelled) || memory.hits === 0)
      throw new Error('Optional error swallowed')
    return {
      bytes: 0,
      encodedChecksum: 0,
      decodedChecksum: 0,
      samples: 0,
      alphaError: 0,
      propagated: true,
      hits: memory.hits,
      callerPreserved,
      ownedLive,
      ownedAllocations,
      ownedPeak,
    }
  }
  if (error || !encoded) throw new Error('Coefficient entropy encoding failed', { cause: error })
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgba8'
  )
    throw new Error('Coefficient output layout changed')
  const pixels = new Uint8Array(width * height * 4)
  let rows = 0,
    alphaError = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgba8' ||
        block.x !== 0 ||
        block.y !== rows ||
        block.width !== width ||
        block.y + block.height > height
      )
        throw new Error('Coefficient output rows changed')
      for (let y = 0; y < block.height; y++) {
        const row = block.data.subarray(y * block.stride, y * block.stride + width * 4)
        pixels.set(row, (block.y + y) * width * 4)
        for (let at = 3; at < row.length; at += 4)
          alphaError = Math.max(alphaError, Math.abs((row[at] ?? 0) - 255))
      }
      rows += block.height
    } finally {
      block.release?.()
    }
  }
  if (rows !== height) throw new Error('Incomplete coefficient output')
  return {
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    decodedChecksum: checksum(pixels),
    samples: pixels.length,
    alphaError,
    propagated: false,
    hits: memory.hits,
    callerPreserved,
    ownedLive,
    ownedAllocations,
    ownedPeak,
  }
}
