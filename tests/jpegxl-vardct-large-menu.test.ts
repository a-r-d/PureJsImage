import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  type JpegXlLargeMenuInput,
  jpegXlAcTokenRate,
  prepareJpegXlLargeMenus,
} from '../src/codecs/jpegxl-vardct-large-menu.ts'
import { defaultJpegXlQuantizationBiases } from '../src/codecs/jpegxl-vardct-quantization.ts'
import {
  verifyLargeLfTransforms,
  verifyLargeSourceSelection,
} from './helpers/jpegxl-large-source.ts'

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
  it('keeps LF coefficients, output margins and input exact on signed square and rectangle patterns', () => {
    expect(verifyLargeLfTransforms()).toEqual({
      shapes: 3,
      maximumLfError: 0,
      changedMargins: 0,
      changedInput: 0,
    })
  })
  it.each(
    (['admitted', 'refused', 'zeros', 'zero-refused'] as const).flatMap((budget) => [
      { budget, fused: false },
      { budget, fused: true },
    ]),
  )(
    'preserves every nonconstant menu with plane rounding scratch $budget, fused $fused',
    ({ budget, fused }) => {
      const input = fixture()
      const planes = [new Float32Array(64), new Float32Array(64), new Float32Array(64)] as const
      for (const c of [0, 1, 2] as const)
        for (let p = 0; p < 64; p++) planes[c][p] = 0.125 * (c + 1) + 0.025 * Math.cos(p * (c + 1))
      const run = (memory: JpegXlEncoderMemory, usePlane: boolean, useZeros = false) => {
        let calls = 0,
          skipped = 0,
          fusedCalls = 0
        const values = new Float64Array(1024)
        const menus: { rates: number[]; errors: number[]; counts: number[] }[] = []
        const quantizeLargeAc: NonNullable<JpegXlLargeMenuInput['quantizeLargeAc']> = (
          transformed,
          matrix,
          scale,
          _channel,
          count,
          output,
          active,
        ) => {
          calls++
          output.fill(0, 0, count)
          const available = active?.count ?? count
          if (active) skipped += (count === 512 ? 504 : 1008) - available
          let kept = 0
          for (let position = 0; position < available; position++) {
            const p = active ? (active.indices[position] ?? 0) : position
            const value = Math.round((transformed[p] ?? 0) / (scale * (matrix[p] ?? 0)))
            output[p] = value
            if (active && value !== 0) active.indices[kept++] = p
          }
          if (active) active.count = kept
        }
        const quantizeAndReconstructLargeAc: NonNullable<
          JpegXlLargeMenuInput['quantizeAndReconstructLargeAc']
        > = (transformed, matrix, scale, channel, count, output, integers, rate, active) => {
          fusedCalls++
          quantizeLargeAc(transformed, matrix, scale, channel, count, values, active)
          output.fill(0)
          integers?.fill(0)
          const available = active?.count ?? count,
            rows = count === 512 ? 2 : 4
          let nonzero = 0
          for (let position = 0; position < available; position++) {
            const p = active ? (active.indices[position] ?? 0) : position
            if (!active && p >>> 5 < rows && (p & 31) < 4) continue
            const value = values[p] ?? 0,
              step = scale * (matrix[p] ?? 0)
            if (value === 0) {
              output[p] = 0 * step
              continue
            }
            if (integers) integers[p] = value
            else rate += jpegXlAcTokenRate(value)
            nonzero++
            const decoded =
              Math.abs(value) === 1
                ? Math.sign(value) * (defaultJpegXlQuantizationBiases[channel] ?? 1)
                : value - 0.145 / value
            output[p] = decoded * step
          }
          return { nonzero, rate }
        }
        for (const _ of prepareJpegXlLargeMenus({
          ...input,
          memory,
          fill8: () => planes,
          ...(usePlane ? { quantizeLargeAc } : {}),
          ...(usePlane && fused ? { quantizeAndReconstructLargeAc } : {}),
          monotonicLargeZeros: useZeros,
          addWindow: (_index, menu) => {
            menus.push({
              rates: [...menu.coefficientRates],
              errors: [...menu.errors],
              counts: [...menu.nonzeroCounts],
            })
          },
        })) {
          /* consume cooperative yields */
        }
        expect(memory.liveBytes).toBe(0)
        expect(memory.liveAllocations).toBe(0)
        return { menus, calls, skipped, fusedCalls, peak: memory.peakBytes }
      }
      const baseline = run(new JpegXlEncoderMemory(1_000_000), false)
      const candidate = run(
        new JpegXlEncoderMemory(
          budget === 'refused'
            ? baseline.peak
            : budget === 'zero-refused'
              ? baseline.peak + 8192
              : 1_000_000,
        ),
        true,
        budget === 'zeros' || budget === 'zero-refused',
      )
      expect(candidate.menus).toEqual(baseline.menus)
      expect(candidate.calls).toBe(budget === 'refused' ? 0 : 135)
      expect(candidate.fusedCalls).toBe(fused && budget !== 'refused' ? 135 : 0)
      if (budget === 'zeros') expect(candidate.skipped).toBeGreaterThan(0)
      else expect(candidate.skipped).toBe(0)
      expect(Math.max(...(candidate.menus[0]?.counts ?? []))).toBeGreaterThan(0)
    },
  )
  it('rejects nonfinite plane tokens and releases scratch after plane callback failure', () => {
    for (const failure of ['nonfinite', 'callback', 'fused-callback'] as const) {
      const input = fixture()
      const error = new Error('plane callback failed')
      const iterator = prepareJpegXlLargeMenus({
        ...input,
        quantizeLargeAc: (_transformed, _matrix, _scale, _channel, _count, output) => {
          if (failure === 'callback') throw error
          output.fill(NaN)
        },
        ...(failure === 'fused-callback'
          ? {
              quantizeAndReconstructLargeAc: () => {
                throw error
              },
            }
          : {}),
      })
      expect(() => iterator.next()).toThrow(failure === 'nonfinite' ? 'AC range' : error)
      expect(input.memory.liveBytes).toBe(0)
      expect(input.memory.liveAllocations).toBe(0)
    }
  })
  it.each([-4095, -1, -0.5, 0, 0.5, 1, 4095])(
    'preserves estimated AC rates for signed or fractional token %s',
    (token) => {
      const input = fixture()
      const rate = token === 0 ? 0 : 1 + 2 * Math.log2(1 + Math.abs(token))
      let windows = 0
      for (const _ of prepareJpegXlLargeMenus({
        ...input,
        quantizeAc: () => token,
        addWindow: (_index, menu) => {
          windows++
          for (let index = 0; index < menu.coefficientRates.length; index++) {
            const count = index < 36 ? 3 * (512 - 8) : 3 * (1024 - 16)
            let expected = 0
            for (let p = 0; p < count; p++) expected += rate
            expect(menu.coefficientRates[index]).toBe(expected)
          }
        },
      })) {
        /* consume cooperative yields */
      }
      expect(windows).toBe(1)
      expect(input.memory.liveAllocations).toBe(0)
    },
  )

  it('preserves estimated DC rates beyond the AC range and across signed-word extremes', () => {
    const input = fixture()
    for (let y = 0; y < 4; y++) {
      input.dc[0][y * 4] = -2147483648
      for (let x = 1; x < 4; x++) input.dc[0][y * 4 + x] = 2147483647
    }
    input.dc[1].fill(-4096)
    input.dc[2].fill(4096)
    let expected = 0,
      windows = 0
    for (const magnitude of [2147483648, 4294967295, 4096, 4096])
      expected += 1 + 2 * Math.log2(1 + magnitude)
    for (const _ of prepareJpegXlLargeMenus({
      ...input,
      quantizeAc: () => 0,
      addWindow: (_index, menu) => {
        windows++
        expect(menu.baselineCoefficientRate).toBe(expected)
      },
    })) {
      /* consume cooperative yields */
    }
    expect(windows).toBe(1)
    expect(input.memory.liveAllocations).toBe(0)
  })

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
  it.each([false, true])(
    'preserves signed even and odd source energy in both rectangles and the square, asymmetric %s',
    (asymmetric) => {
      const input = fixture()
      const planes = [
        new Float32Array(1024),
        new Float32Array(1024),
        new Float32Array(1024),
      ] as const
      const block = [new Float32Array(64), new Float32Array(64), new Float32Array(64)] as const
      const energy = new Float64Array(5)
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const at = y * 32 + x
          const amplitude = asymmetric ? 1 + (x < 16 ? 0 : 0.125) + (y < 16 ? 0 : 0.25) : 1
          for (const c of [0, 1, 2] as const)
            planes[c][at] =
              amplitude *
              ((c + 1) / 16) *
              Math.cos(((2 * x + 1) * (c === 1 ? 30 : 31) * Math.PI) / 64) *
              Math.cos(((2 * y + 1) * (c === 0 ? 30 : 31) * Math.PI) / 64)
          const sx = planes[0][at] ?? 0,
            sy = planes[1][at] ?? 0,
            sb = (planes[2][at] ?? 0) + sy,
            error = (sy + sx) ** 2 + (sy - sx) ** 2 + sb ** 2
          // Parseval's identity gives spatial error when all reconstructed AC
          // and compact DC are zero, independently of the forward transform.
          for (const index of [x < 16 ? 0 : 1, y < 16 ? 2 : 3, 4])
            energy[index] = (energy[index] ?? 0) + error
        }
      for (const dc of input.dc) dc.fill(0)
      let windows = 0
      for (const _ of prepareJpegXlLargeMenus({
        ...input,
        fill8: (_correlated, bx, by) => {
          for (const c of [0, 1, 2] as const)
            for (let y = 0; y < 8; y++)
              for (let x = 0; x < 8; x++)
                block[c][y * 8 + x] = planes[c][(by * 8 + y) * 32 + bx * 8 + x] ?? 0
          return block
        },
        quantizeAc: () => 0,
        addWindow: (_index, menu) => {
          windows++
          expect([...menu.compactDc]).toEqual(new Array<number>(144).fill(0))
          expect(menu.baselineError).toBeCloseTo(energy[4] ?? 0, 10)
          for (let i = 0; i < 45; i++)
            expect(menu.errors[i]).toBeCloseTo(energy[i < 36 ? Math.floor(i / 9) : 4] ?? 0, 10)
        },
      })) {
        /* consume cooperative yields */
      }
      expect(windows).toBe(1)
      expect(input.memory.liveBytes).toBe(0)
      expect(input.memory.liveAllocations).toBe(0)
    },
  )
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
