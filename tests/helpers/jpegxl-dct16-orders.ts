import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import {
  encodeVarDctCoefficientSections,
  learnJpegXlForwardCoefficientOrders,
  varDctCodestreamParts,
  type VarDctCoefficientGeometry,
} from '../../src/codecs/jpegxl-jpeg-encode.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

export function createDct16OrderGeometry(memory: JpegXlEncoderMemory): VarDctCoefficientGeometry {
  const across = 64,
    down = 16,
    groupWidth = 32,
    groupHeight = 16
  const offsets = new Int32Array(groupWidth * groupHeight).fill(-1)
  const coefficients = [
    new Int16Array(groupWidth * groupHeight * 64),
    new Int16Array(groupWidth * groupHeight * 64),
    new Int16Array(groupWidth * groupHeight * 64),
  ]
  let offset = 0
  for (let y = 0; y < groupHeight; y += 2)
    for (let x = 0; x < groupWidth; x += 2) {
      offsets[y * groupWidth + x] = offset
      for (let channel = 0; channel < 3; channel++) {
        const plane = coefficients[channel]
        if (!plane) throw new Error('Missing synthetic DCT16 channel')
        plane[offset + 227 - channel * 19] = ((x + y + channel) & 2) === 0 ? 1 : -1
        if ((x + y) % 6 === 0) plane[offset + 199 - channel * 13] = 2
      }
      offset += 256
    }
  const dcComponents = [150, 0, 0].map((value) => ({
    blocksPerLineForMcu: across,
    blocksPerColumnForMcu: down,
    coefficientStride: 1 as const,
    coefficients: new Int32Array(across * down).fill(value),
  }))
  return {
    colorTransform: 'xyb',
    chromaSubsampling: [0, 0, 0],
    shifts: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    blocksWide: across,
    blocksHigh: down,
    groupsAcross: 2,
    groupsDown: 1,
    dcAcross: 1,
    dcDown: 1,
    acComponents: [],
    dcComponents,
    quantization: [
      new Int32Array(64).fill(1),
      new Int32Array(64).fill(1),
      new Int32Array(64).fill(1),
    ],
    dcQuantization: [1 / 8192, 1 / 1024, 1 / 512],
    defaultMatrices: true,
    globalScale: 8192,
    quantAc: 4,
    quantDc: 4,
    baseB: 1,
    effort: 7,
    strategyMap: new Int32Array(across * down).fill(4),
    quantizationMap: new Int32Array(across * down).fill(4),
    memory,
    loadAc: () =>
      coefficients.map((values) => ({
        blocksPerLineForMcu: groupWidth,
        blocksPerColumnForMcu: groupHeight,
        coefficientOffsets: offsets,
        coefficients: values,
      })),
  }
}

const assemble = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export function encodeDct16OrderFixture(learned: boolean): Uint8Array {
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    const encoded = memory.run(() => {
      const original = createDct16OrderGeometry(memory)
      const learning = learnJpegXlForwardCoefficientOrders(original)
      let result = learning.next()
      while (!result.done) result = learning.next()
      const geometry = learned ? { ...original, coefficientOrders: result.value } : original
      return assemble(
        varDctCodestreamParts(
          { width: 512, height: 128 },
          geometry,
          encodeVarDctCoefficientSections(geometry),
        ),
      )
    })
    if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
      throw new Error('DCT16 fixture retained owner storage')
    return encoded
  } finally {
    memory.close()
  }
}

export async function decodeDct16OrderFixture(encoded: Uint8Array): Promise<Uint8Array> {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (decoder?.width !== 512 || decoder.height !== 128 || decoder.pixelFormat !== 'rgb8')
    throw new Error('DCT16 fixture layout changed')
  const output = new Uint8Array(512 * 128 * 3)
  let rows = 0
  for await (const block of decoder.decode()) {
    try {
      if (block.x !== 0 || block.y !== rows || block.width !== 512)
        throw new Error('DCT16 rows missing or duplicated')
      for (let y = 0; y < block.height; y++)
        output.set(
          block.data.subarray(y * block.stride, y * block.stride + 512 * 3),
          (rows + y) * 512 * 3,
        )
      rows += block.height
    } finally {
      block.release?.()
    }
  }
  if (rows !== 128) throw new Error('DCT16 fixture incomplete')
  return output
}

export async function verifyDct16Orders() {
  const natural = encodeDct16OrderFixture(false)
  const learned = encodeDct16OrderFixture(true)
  const originalPixels = await decodeDct16OrderFixture(natural)
  const learnedPixels = await decodeDct16OrderFixture(learned)
  let decodedChecksum = 2166136261
  for (let index = 0; index < originalPixels.length; index++) {
    const value = originalPixels[index] ?? 0
    if (value !== learnedPixels[index]) throw new Error('DCT16 order changed decoded pixels')
    decodedChecksum = Math.imul(decodedChecksum ^ value, 16777619) >>> 0
  }
  if (learned.length >= natural.length) throw new Error('DCT16 order did not reduce fixture size')
  return {
    naturalBytes: natural.length,
    learnedBytes: learned.length,
    decodedChecksum,
    samples: originalPixels.length,
  }
}
