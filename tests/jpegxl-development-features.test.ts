import { expect, it } from 'vitest'
import { extractDecisions } from '../benchmark/jpegxl/lossy-lab/decisions.ts'
import { extractDevelopmentReferences } from '../benchmark/jpegxl/lossy-lab/feature-transplant.ts'
import { inverseDevelopmentGaborish } from '../benchmark/jpegxl/lossy-lab/source-transplant.ts'
import {
  assertTransplantDecisions,
  encodeTransplant,
  transplantOverrides,
} from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

it('inverts the signaled Gaborish kernel at edges and interiors', () => {
  const width = 17,
    height = 13
  const input = Float32Array.from(
    { length: width * height },
    (_, i) => 0.4 + 0.12 * Math.sin(i * 1.3) + 0.08 * Math.cos(i / 9),
  )
  const inverse = inverseDevelopmentGaborish(input, width, height)
  const adjacent = 1.1 * 0.104699568,
    diagonal = 1.1 * 0.055680538
  const norm = 1 / (1 + 4 * (adjacent + diagonal))
  let maximum = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sample = (dx: number, dy: number) =>
        inverse[
          Math.max(0, Math.min(height - 1, y + dy)) * width +
            Math.max(0, Math.min(width - 1, x + dx))
        ] ?? 0
      const filtered =
        norm *
        (sample(0, 0) +
          adjacent * (sample(-1, 0) + sample(1, 0) + sample(0, -1) + sample(0, 1)) +
          diagonal * (sample(-1, -1) + sample(1, -1) + sample(-1, 1) + sample(1, 1)))
      maximum = Math.max(maximum, Math.abs(filtered - (input[y * width + x] ?? 0)))
    }
  expect(maximum).toBeLessThan(8e-8)
})

it('re-encodes exact XYB reference samples and composes overlapping additive patches', async () => {
  const width = 32,
    height = 32
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : 100 + (i % 4) * 25 + Math.round(6 * Math.sin(Math.floor(i / 4) / 15)),
  )
  const control = await encodeTransplant(pixels, width, height, 2, {})
  const own = await extractDecisions(control.bytes)
  const references = [
    {
      width: 2,
      height: 2,
      id: 3 as const,
      planes: [
        Int32Array.from([1, 2, 3, 4]),
        Int32Array.from([1, 0, -1, 0]),
        new Int32Array(4),
        new Int32Array(4),
      ],
      dcQuantization: [1 / 1024, 1 / 512, 1 / 512] as const,
    },
  ]
  const blending = [
    { mode: 2, alphaChannel: 0, clamp: false },
    { mode: 0, alphaChannel: 0, clamp: false },
  ]
  const patches = [4, 5].map((x) => ({
    referenceId: 3 as const,
    referenceX: 0,
    referenceY: 0,
    x,
    y: 4,
    width: 2,
    height: 2,
    blendMode: 2,
    blending,
  }))
  const d = {
    ...own,
    references,
    patches,
    dependencies: [
      {
        frameType: 'reference' as const,
        encoding: 'modular' as const,
        width: 2,
        height: 2,
        saveAsReference: 3 as const,
        saveBeforeColorTransform: true,
        sectionBytes: 0,
      },
    ],
  }
  const firstPatch = patches[0]
  if (!firstPatch) throw new Error('Missing first test patch')
  await expect(
    encodeTransplant(
      pixels,
      width,
      height,
      2,
      transplantOverrides('features', { ...d, patches: [{ ...firstPatch, referenceX: 2 }] }),
    ),
  ).rejects.toThrow('extent')
  for (const component of ['features', 'all'] as const) {
    const overrides = transplantOverrides(component, d)
    const encoded = await encodeTransplant(pixels, width, height, 2, overrides)
    assertTransplantDecisions(overrides, await extractDecisions(encoded.bytes))
    expect(await extractDevelopmentReferences(encoded.bytes)).toEqual(references)
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded.bytes),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Missing decoder')
    let samples = 0,
      error = 0
    for await (const block of decoder.decode()) {
      try {
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++) {
            const at = y * block.stride + x * 4
            expect(block.data[at + 3]).toBe(255)
            for (let c = 0; c < 3; c++) {
              error += Math.abs(
                (block.data[at + c] ?? 0) -
                  (pixels[((block.y + y) * width + block.x + x) * 4 + c] ?? 0),
              )
              samples++
            }
          }
      } finally {
        block.release?.()
      }
    }
    expect(samples).toBe(width * height * 3)
    expect(error / samples).toBeLessThan(3)
  }
}, 30_000)
