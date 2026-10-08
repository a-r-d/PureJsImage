import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  type JpegXlLargeMenuInput,
  prepareJpegXlLargeMenus,
} from '../src/codecs/jpegxl-vardct-large-menu.ts'
import { verifyLargeSourceSelection } from './helpers/jpegxl-large-source.ts'

const fixture = (wide = 4, high = 4): JpegXlLargeMenuInput => {
  const cells = wide * high
  const source = [
    new Float32Array(64).fill(0.125),
    new Float32Array(64).fill(0.5),
    new Float32Array(64).fill(0.25),
  ] as const
  const correlated = [new Float32Array(64), source[1], new Float32Array(64)] as const
  for (let p = 0; p < 64; p++) {
    correlated[0][p] = (source[0][p] ?? 0) - 0.25 * (source[1][p] ?? 0)
    correlated[2][p] = (source[2][p] ?? 0) + 0.5 * (source[1][p] ?? 0)
  }
  return {
    memory: new JpegXlEncoderMemory(1_000_000),
    blocksWide: wide,
    blocksHigh: high,
    globalScale: 65536,
    strategyMap: new Int32Array(cells),
    quantizationMap: new Int32Array(cells).fill(8),
    dc: [
      new Int32Array(cells).fill(128),
      new Int32Array(cells).fill(512),
      new Int32Array(cells).fill(256),
    ],
    dcFactors: [1 / 1024, 1 / 1024, 1 / 1024],
    correlationX: new Int32Array(Math.ceil(wide / 8) * Math.ceil(high / 8)).fill(21),
    correlationB: new Int32Array(Math.ceil(wide / 8) * Math.ceil(high / 8)).fill(-42),
    smoothDc: true,
    fill8: (isCorrelated) => (isCorrelated ? correlated : source),
    quantizeAc: (value) => Math.round(value),
    fillWeights: (_x, _y, out) => out.fill(1),
    learnBaselineCount: () => {},
    addWindow: () => {},
    check: () => {},
  }
}

describe('bounded JPEG XL large-transform menus', () => {
  it('selects complete large transforms from nonconstant source without changing its baseline', () => {
    const result = verifyLargeSourceSelection()
    expect(result.menuCount).toBe(2)
    expect(result.stats.selectedSquare).toBe(2)
    expect(result.strategies).toEqual(new Array<number>(32).fill(5))
    expect(result.baselineUnchanged).toBe(true)
    expect(result.finalOwnedBytes).toBe(0)
    expect(result.finalOwnedAllocations).toBe(0)
  })
  it('preserves flat physical source and pre-CfL DC across all 45 alternatives', () => {
    const input = fixture(),
      dcBefore = input.dc.map((plane) => plane.slice()),
      qBefore = input.quantizationMap.slice()
    let windows = 0,
      symbols = 0
    const iterator = prepareJpegXlLargeMenus({
      ...input,
      learnBaselineCount: (count) => {
        expect(count).toBe(0)
        symbols++
      },
      addWindow: (index, menu) => {
        expect(index).toBe(0)
        windows++
        expect([...menu.coefficientRates]).toEqual(new Array<number>(45).fill(0))
        expect([...menu.nonzeroCounts]).toEqual(new Array<number>(135).fill(0))
        expect([...menu.baselineCounts]).toEqual(new Array<number>(48).fill(0))
        expect(menu.baselineError).toBeLessThan(1e-25)
        for (const error of menu.errors) expect(error).toBeLessThan(1e-25)
        for (let family = 0; family < 3; family++)
          for (let c = 0; c < 3; c++)
            for (let p = 0; p < 16; p++)
              expect(menu.compactDc[family * 48 + c * 16 + p]).toBe(
                c === 0 ? 512 : c === 1 ? 128 : 256,
              )
      },
    })
    for (const _ of iterator) {
      /* consume cooperative yields */
    }
    expect(windows).toBe(1)
    expect(symbols).toBe(48)
    expect(input.quantizationMap).toEqual(qBefore)
    expect(input.dc).toEqual(dcBefore)
    expect(input.memory.liveBytes).toBe(0)
    expect(input.memory.liveAllocations).toBe(0)
    expect(input.memory.peakBytes).toBeLessThan(300_000)
  })
  it('learns each edge leader once and excludes DCT16 followers', () => {
    const input = fixture(5, 5)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) input.strategyMap[y * 5 + x] = 4
    let symbols = 0,
      followerCounts = 0
    for (const _ of prepareJpegXlLargeMenus({
      ...input,
      learnBaselineCount: () => symbols++,
      addWindow: (_index, menu) => {
        for (const count of menu.baselineCounts) if (count === 65535) followerCounts++
      },
    })) {
      /* consume */
    }
    expect(symbols).toBe((25 - 3) * 3)
    expect(followerCounts).toBe(9)
    expect(input.memory.liveAllocations).toBe(0)
  })
  it('releases scratch when stopped at a cooperative boundary', () => {
    const input = fixture(8, 4),
      iterator = prepareJpegXlLargeMenus(input)
    expect(iterator.next().done).toBe(false)
    expect(input.memory.liveBytes).toBeGreaterThan(0)
    iterator.return()
    expect(input.memory.liveBytes).toBe(0)
  })
  it('releases all admitted scratch after a partial allocation failure', () => {
    const input = fixture(),
      memory = new JpegXlEncoderMemory(20_000)
    expect(() => prepareJpegXlLargeMenus({ ...input, memory }).next()).toThrow()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
  })
  it('propagates cancellation and callback errors after releasing scratch', () => {
    for (const phase of ['check', 'window'] as const) {
      const input = fixture(),
        error = new Error('cancelled')
      const iterator = prepareJpegXlLargeMenus({
        ...input,
        check: () => {
          if (phase === 'check') throw error
        },
        addWindow: () => {
          if (phase === 'window') throw error
        },
      })
      expect(() => iterator.next()).toThrow(error)
      expect(input.memory.liveAllocations).toBe(0)
    }
  })
})
