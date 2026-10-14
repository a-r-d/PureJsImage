import { expect, it } from 'vitest'
import {
  allocationGrid,
  allocationOverrides,
  parseAllocation,
} from '../benchmark/jpegxl/lossy-lab/allocation.ts'
import { assertAllocationScreen } from '../benchmark/jpegxl/lossy-lab/allocation-screen.ts'
import { extractDecisions } from '../benchmark/jpegxl/lossy-lab/decisions.ts'
import { libjxlDcOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-dc-port.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'

const pixels = Uint8Array.from({ length: 48 * 40 * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : Math.round(95 + (i % 4) * 23 + 20 * Math.sin(Math.floor(i / 4) / 13)),
)

it.each([0.5, 1, 2, 4, 7])(
  'preserves the unchanged encoder at neutral knobs and distance %s',
  async (distance) => {
    const control = await encodeTransplant(pixels, 48, 40, distance, {})
    const candidate = await encodeTransplant(
      pixels,
      48,
      40,
      distance,
      allocationOverrides(parseAllocation('0,1,own'), distance),
    )
    expect(candidate.bytes).toEqual(control.bytes)
  },
)

it.each(['off', 'on'] as const)(
  'signals blended DC steps independently of AC precision with smoothing %s',
  async (smoothing) => {
    const own = await extractDecisions((await encodeTransplant(pixels, 48, 40, 2, {})).bytes)
    const dc = libjxlDcOverrides(2, false).dc
    if (!dc) throw new Error('Missing DC port')
    const candidate = await extractDecisions(
      (
        await encodeTransplant(
          pixels,
          48,
          40,
          2,
          allocationOverrides({ alpha: 0.5, acScale: 1.6, smoothing }, 2),
        )
      ).bytes,
    )
    expect(candidate.globalScale).toBe(Math.round(own.globalScale * 1.6))
    expect(candidate.smoothDc).toBe(smoothing === 'on')
    for (let c = 0; c < 3; c++) {
      const before = (65536 / own.globalScale / own.quantDc) * (own.dcQuantization[c] ?? 0)
      const after =
        (65536 / candidate.globalScale / candidate.quantDc) * (candidate.dcQuantization[c] ?? 0)
      expect(after / Math.sqrt(before * (dc.quantization[c] ?? 0))).toBeCloseTo(1, 3)
    }
  },
)

it('defines all 32 allocation trials and rejects malformed CLI points', () => {
  expect(allocationGrid).toHaveLength(32)
  for (const bad of ['NaN,1,on', '0.3,1,off', '0,0,on', '0,1,on,extra'])
    expect(() => parseAllocation(bad)).toThrow('Invalid allocation')
})

it('distinguishes measured screen completion from partial quality-band coverage', () => {
  const complete = {
    selectedImages: 16,
    failures: [],
    speed: [{ engine: 'purejsimage', lab: { count: 80 } }],
    omissions: [{ reason: 'incomplete required-range overlap' }],
  }
  expect(() => assertAllocationScreen(complete)).not.toThrow()
  expect(() => assertAllocationScreen({ ...complete, failures: ['encode failed'] })).toThrow()
  expect(() =>
    assertAllocationScreen({ ...complete, speed: [{ engine: 'purejsimage', lab: { count: 79 } }] }),
  ).toThrow()
})
