import { expect, it } from 'vitest'
import {
  type PerceptualImage,
  perceptualQuadraticMaps,
} from '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-local-port.ts'

function fixture(factor: number): PerceptualImage {
  const values = (channel: number) =>
    Float64Array.from({ length: 6 }, (_, p) => (p - 2) * (0.25 + channel) * factor)
  return {
    width: 3,
    height: 2,
    lf: [values(1), values(2), values(3)],
    mf: [values(4), values(5), values(6)],
    hf: [values(7), values(8)],
    uhf: [values(9), values(10)],
    blurredActivity: Float64Array.from([0, 1, 2, 3, 4, 5], (v) => v * factor),
    mask: Float64Array.from([0, 0.5, 2, 4, 8, 16]),
  }
}

it('preserves pinned quadratic costs for sign reversal and both asymmetric penalty bounds', () => {
  const source = fixture(1)
  // Pinned before channel specialization; columns exercise opposite signs, zero HF and masks.
  for (const [factor, expected] of [
    [
      -0.75,
      [
        255.72617990983994, 107.19146977976182, 1.9390456024428149, 61.773216388891065,
        98.82182546863112, 124.00104937477509,
      ],
    ],
    [
      0.2,
      [
        111.05618231451815, 46.549868102043334, 0.8864208468310012, 26.82815431796711,
        42.91687796867903, 53.85173447853775,
      ],
    ],
    [
      0.8,
      [
        27.508992220446093, 11.530512608651689, 0.22160521170775022, 6.645491934242009,
        10.630691922899686, 13.339296700283144,
      ],
    ],
    [
      1.5,
      [
        78.35439663426014, 32.844273192169325, 0.5540130292693757, 18.926076321361933,
        30.27831868520123, 37.99315394532928,
      ],
    ],
  ] as const) {
    const decoded = fixture(factor),
      full = perceptualQuadraticMaps(source, decoded),
      box = perceptualQuadraticMaps(source, decoded, { x: 1, y: 1, width: 2, height: 1 })
    expect([...full.asymmetric]).toEqual(expected)
    for (const key of ['unmasked', 'masked', 'asymmetric'] as const)
      expect(box[key]).toEqual(full[key].slice(4, 6))
    if (factor === 0.8) expect(full.asymmetric).toEqual(full.masked)
  }
  const reversed = perceptualQuadraticMaps(source, fixture(-0.75))
  expect([...reversed.unmasked]).toEqual([
    833.5592531066143, 416.8163649737306, 11.067971810589327, 417.11015584604763, 833.8531216225413,
    1250.6450091809536,
  ])
  expect([...reversed.masked]).toEqual([
    240.70368192890342, 100.89198532570232, 1.9390456024428149, 58.14805442461761, 93.0185543253723,
    116.71884612747756,
  ])
})

it('preserves pinned six-band directional sums across repeated full and border windows', async () => {
  const { perceptualDirectionalMap } = await import(
    '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-malta-port.ts'
  )
  const source = fixture(1),
    decoded = fixture(-0.75),
    expected = [
      336.8915649830061, 146.1614839229567, 47.65886759472686, 100.74379438077136,
      134.6610768706983, 164.21848344305297,
    ]
  for (let repeat = 0; repeat < 2; repeat++) {
    const quadratic = perceptualQuadraticMaps(source, decoded).asymmetric
    expect([...perceptualDirectionalMap(source, decoded, quadratic)]).toEqual(expected)
    for (const x of [2, 0, 1]) {
      const box = { x, y: 1, width: 1, height: 1 },
        local = perceptualQuadraticMaps(source, decoded, box).asymmetric
      expect([...perceptualDirectionalMap(source, decoded, local, box)]).toEqual([expected[x + 3]])
    }
  }
})
