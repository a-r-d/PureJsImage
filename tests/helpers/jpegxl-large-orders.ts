import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeVarDctCoefficientSections,
  learnJpegXlForwardCoefficientOrders,
  type VarDctCoefficientGeometry,
  varDctCodestreamParts,
} from '../../src/codecs/jpegxl-jpeg-encode.ts'
import { createDct16OrderGeometry, decodeDct16OrderFixture } from './jpegxl-dct16-orders.ts'

/** Adjacent complete square and rectangle transforms, crossing the AC-group boundary. */
export function createLargeOrderGeometry(
  memory: JpegXlEncoderMemory,
  groups: 1 | 2 = 2,
): VarDctCoefficientGeometry {
  const original = createDct16OrderGeometry(memory)
  const across = groups * 32
  const strategyMap = new Int32Array(across * 16)
  const offsets = new Int32Array(32 * 16).fill(-1)
  const coefficients = [new Int16Array(32_768), new Int16Array(32_768), new Int16Array(32_768)]
  let cursor = 0
  for (let windowY = 0; windowY < 16; windowY += 4)
    for (let windowX = 0; windowX < 32; windowX += 4) {
      const kind = ((windowX + windowY) / 4) % 4
      const strategy = kind === 0 ? 5 : kind === 1 ? 10 : kind === 2 ? 11 : 4
      const width = strategy === 5 || strategy === 11 ? 4 : 2
      const height = strategy === 5 || strategy === 10 ? 4 : 2
      const size = width * height * 64
      for (let y = windowY; y < windowY + 4; y += height)
        for (let x = windowX; x < windowX + 4; x += width) {
          offsets[y * 32 + x] = cursor
          for (let dy = 0; dy < height; dy++)
            for (let dx = 0; dx < width; dx++) {
              strategyMap[(y + dy) * across + x + dx] = strategy
              if (groups === 2) strategyMap[(y + dy) * across + 32 + x + dx] = strategy
            }
          for (let channel = 0; channel < 3; channel++) {
            const plane = coefficients[channel]
            if (!plane) throw new Error('Missing large fixture channel')
            plane[cursor + size - 29 - channel * 19] = ((x + y + channel) & 2) === 0 ? 1 : -1
            if ((x + y) % 6 === 0) plane[cursor + size - 57 - channel * 13] = 2
          }
          cursor += size
        }
    }
  if (cursor !== 32_768) throw new Error('Large fixture coverage is incomplete')
  return {
    ...original,
    blocksWide: across,
    groupsAcross: groups,
    dcComponents: original.dcComponents.map((component) => ({
      ...component,
      blocksPerLineForMcu: across,
      coefficients: new Int32Array(across * 16).fill(component.coefficients[0] ?? 0),
    })),
    strategyMap,
    loadAc: () =>
      coefficients.map((values) => ({
        blocksPerLineForMcu: 32,
        blocksPerColumnForMcu: 16,
        coefficientOffsets: offsets,
        coefficients: values,
      })),
  }
}

export function encodeLargeOrderFixture(
  learned: boolean,
  familyContexts = false,
  groups: 1 | 2 = 2,
): Uint8Array {
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    const encoded = memory.run(() => {
      const original = createLargeOrderGeometry(memory, groups)
      const learning = learnJpegXlForwardCoefficientOrders(original)
      let result = learning.next()
      while (!result.done) result = learning.next()
      const geometry = {
        ...original,
        familyContexts,
        ...(learned ? { coefficientOrders: result.value } : {}),
      }
      const parts = varDctCodestreamParts(
        { width: groups * 256, height: 128 },
        geometry,
        encodeVarDctCoefficientSections(geometry),
      )
      const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
      let offset = 0
      for (const part of parts) {
        bytes.set(part, offset)
        offset += part.length
      }
      return bytes
    })
    if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
      throw new Error('Large fixture retained owner storage')
    return encoded
  } finally {
    memory.close()
  }
}

export async function verifyLargeCoefficientOrders() {
  const natural = encodeLargeOrderFixture(false)
  const learned = encodeLargeOrderFixture(true)
  const originalPixels = await decodeDct16OrderFixture(natural)
  const pixels = await decodeDct16OrderFixture(learned)
  if (learned.length >= natural.length) throw new Error('Large order did not reduce fixture size')
  for (let index = 0; index < originalPixels.length; index++)
    if (originalPixels[index] !== pixels[index])
      throw new Error('Large order changed decoded pixels')
  // The single-group path uses prefix entropy rather than the two-group ANS path.
  // Each encoder call also asserts both owner counters are exactly zero before closing.
  const prefixNatural = encodeLargeOrderFixture(false, false, 1)
  const prefixLearned = encodeLargeOrderFixture(true, false, 1)
  const prefixOriginalPixels = await decodeDct16OrderFixture(prefixNatural, 256)
  const prefixPixels = await decodeDct16OrderFixture(prefixLearned, 256)
  if (prefixOriginalPixels.length !== prefixPixels.length)
    throw new Error('Prefix large order changed decoded sample count')
  for (let index = 0; index < prefixOriginalPixels.length; index++)
    if (prefixOriginalPixels[index] !== prefixPixels[index])
      throw new Error('Prefix large order changed decoded pixels')
  return {
    naturalBytes: natural.length,
    learnedBytes: learned.length,
    samples: pixels.length,
    prefixNaturalBytes: prefixNatural.length,
    prefixLearnedBytes: prefixLearned.length,
    prefixSamples: prefixPixels.length,
  }
}
