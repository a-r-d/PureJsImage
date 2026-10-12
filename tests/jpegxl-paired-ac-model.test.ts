import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  estimateJpegXlForwardAcModel,
  estimateJpegXlForwardAcModelPair,
  type VarDctCoefficientGeometry,
} from '../src/codecs/jpegxl-jpeg-encode.ts'

const complete = <T>(steps: Generator<void, T, void>): T => {
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

const fixture = (
  progressive: boolean,
  luma: boolean,
  ordered: boolean,
): VarDctCoefficientGeometry => {
  const blocksWide = 40,
    blocksHigh = 4
  const components = Array.from({ length: 3 }, (_, channel) => {
    const coefficients = new Int32Array(blocksWide * blocksHigh * 64)
    for (let block = 0; block < blocksWide * blocksHigh; block++) {
      coefficients[block * 64] = ((block * 11) % 29) - 14
      for (let position = 1; position < 64; position++)
        coefficients[block * 64 + position] =
          (block + channel + position) % 5 === 0
            ? 0
            : ((block * 13 + channel * 17 + position * 7) % 19) - 9
    }
    return { blocksPerLineForMcu: blocksWide, blocksPerColumnForMcu: blocksHigh, coefficients }
  })
  const strategyMap = new Int32Array(blocksWide * blocksHigh)
  for (let block = 0; block < strategyMap.length; block++)
    strategyMap[block] = block % 4 === 0 ? 0 : block % 4 === 1 ? 1 : block % 4 === 2 ? 12 : 13
  const order = new Uint32Array(64)
  for (let position = 1; position < 64; position++) order[position] = 64 - position
  return {
    colorTransform: 'xyb',
    chromaSubsampling: [0, 0, 0],
    shifts: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    blocksWide,
    blocksHigh,
    groupsAcross: 2,
    groupsDown: 1,
    dcAcross: 1,
    dcDown: 1,
    acComponents: components,
    dcComponents: components,
    quantization: Array.from({ length: 3 }, () => new Int32Array(64).fill(1)),
    defaultMatrices: true,
    globalScale: 8192,
    quantAc: 4,
    quantDc: 4,
    baseB: 1,
    effort: 7,
    strategyMap,
    progressive,
    ...(luma ? { lumaThreshold: 0 } : {}),
    ...(ordered ? { coefficientOrders: [order, order, order, order, order, order] } : {}),
  }
}

describe('JPEG XL paired forward AC models', () => {
  for (const progressive of [false, true])
    for (const luma of [false, true])
      for (const ordered of [false, true])
        it(`matches independent ordinary/family estimates, progressive=${progressive}, luma=${luma}, ordered=${ordered}`, () => {
          const geometry = fixture(progressive, luma, ordered)
          const copies = geometry.acComponents.map((component) => component.coefficients.slice())
          const memory = new JpegXlEncoderMemory(16_777_216)
          const pairMemory = new JpegXlEncoderMemory(2_000_000)
          const pair = pairMemory.run(() =>
            complete(estimateJpegXlForwardAcModelPair({ ...geometry, memory: pairMemory })),
          )
          const ordinary = memory.run(() =>
            complete(estimateJpegXlForwardAcModel({ ...geometry, familyContexts: false, memory })),
          )
          const family = memory.run(() =>
            complete(estimateJpegXlForwardAcModel({ ...geometry, familyContexts: true, memory })),
          )
          expect(pair).toEqual([ordinary, family])
          expect(ordinary.bits).toBeGreaterThan(0)
          expect(family.bits).toBeGreaterThan(0)
          expect(geometry.acComponents.map((component) => component.coefficients)).toEqual(copies)
          expect(pairMemory.peakBytes).toBeLessThanOrEqual(memory.peakBytes)
          expect(memory.liveBytes).toBeGreaterThan(0)
          for (const model of pair) {
            pairMemory.release(model.contextMap)
            for (const counts of model.frequencies) pairMemory.release(counts)
          }
          for (const model of [ordinary, family]) {
            memory.release(model.contextMap)
            for (const counts of model.frequencies) memory.release(counts)
          }
          expect(pairMemory.liveBytes).toBe(0)
          expect(pairMemory.liveAllocations).toBe(0)
          expect(memory.liveBytes).toBe(0)
          expect(memory.liveAllocations).toBe(0)
          expect(memory.peakBytes).toBeLessThanOrEqual(16_777_216)
          pairMemory.close()
          memory.close()
        })

  it.each([1, 2048, 65_536, 332_640])(
    'releases partially admitted histograms at limit %s',
    (limit) => {
      const memory = new JpegXlEncoderMemory(limit)
      expect(() =>
        memory.run(() =>
          complete(estimateJpegXlForwardAcModelPair({ ...fixture(false, false, false), memory })),
        ),
      ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
      memory.close()
    },
  )

  it('preserves both maximum signed coefficient tokens in compact raw storage', () => {
    const geometry = fixture(false, true, false)
    for (const component of geometry.acComponents)
      for (let position = 0; position < component.coefficients.length; position++)
        if ((position & 63) !== 0)
          component.coefficients[position] = (position & 1) === 0 ? 4095 : -4095
    const memory = new JpegXlEncoderMemory(2_000_000)
    const referenceMemory = new JpegXlEncoderMemory(16_777_216)
    const pair = memory.run(() =>
      complete(estimateJpegXlForwardAcModelPair({ ...geometry, memory })),
    )
    for (const [index, familyContexts] of [false, true].entries()) {
      const reference = referenceMemory.run(() =>
        complete(
          estimateJpegXlForwardAcModel({ ...geometry, familyContexts, memory: referenceMemory }),
        ),
      )
      expect(pair[index]).toEqual(reference)
      referenceMemory.release(reference.contextMap)
      for (const counts of reference.frequencies) referenceMemory.release(counts)
    }
    for (const model of pair) {
      memory.release(model.contextMap)
      for (const counts of model.frequencies) memory.release(counts)
    }
    expect(memory.peakBytes).toBeLessThanOrEqual(2_000_000)
    expect(memory.liveBytes).toBe(0)
    expect(referenceMemory.liveBytes).toBe(0)
    memory.close()
    referenceMemory.close()
  })

  it('releases the histograms when a cooperative caller stops after a group', () => {
    const memory = new JpegXlEncoderMemory(16_777_216)
    memory.run(() => {
      const steps = estimateJpegXlForwardAcModelPair({ ...fixture(false, false, false), memory })
      expect(steps.next().done).toBe(false)
      expect(memory.liveBytes).toBeGreaterThan(0)
      const empty = { bits: 0, acBits: 0, contextMap: new Uint8Array(0), frequencies: [] }
      steps.return([empty, empty])
      expect(memory.liveBytes).toBe(0)
    })
    expect(memory.liveAllocations).toBe(0)
    memory.close()
  })
})
