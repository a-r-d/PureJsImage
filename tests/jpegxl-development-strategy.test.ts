import { expect, it } from 'vitest'
import {
  encodeTransplant,
  transplantOverrides,
  assertTransplantDecisions,
} from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { extractDecisions } from '../benchmark/jpegxl/lossy-lab/decisions.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../src/codecs/jpegxl-vardct-jpeg.ts'
import { MemorySource } from '../src/source.ts'
import { defaultImageLimits } from '../src/limits.ts'

it('signals odd-coordinate leaders and coefficient permutations in wire-family order', async () => {
  const width = 128,
    height = 128
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3
      ? 255
      : Math.round(
          100 +
            (i % 4) * 20 +
            8 * Math.sin((Math.floor(i / 4) % width) / 7) +
            7 * Math.cos(Math.floor(i / 4 / width) / 9),
        ),
  )
  const base = await extractDecisions((await encodeTransplant(pixels, width, height, 2, {})).bytes)
  const strategies = Array.from({ length: 256 }, () => 0),
    first = Array.from({ length: 256 }, () => 1)
  for (const [strategy, x, y] of [
    [10, 7, 1],
    [6, 1, 3],
  ]) {
    if (strategy === undefined || x === undefined || y === undefined)
      throw new Error('Missing test footprint')
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
      bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++) {
        strategies[(y + dy) * 16 + x + dx] = strategy
        first[(y + dy) * 16 + x + dx] = dx === 0 && dy === 0 ? 1 : 0
      }
  }
  const overrides = transplantOverrides('strategy', {
    ...base,
    strategies,
    strategyFirstBlocks: first,
  })
  const rewrite = overrides.rewriteGeometry
  if (!rewrite) throw new Error('Missing strategy rewrite')
  const encoded = await encodeTransplant(pixels, width, height, 2, {
    ...overrides,
    rewriteGeometry: (geometry, context) => {
      const rewritten = rewrite(geometry, context)
      const orders = rewritten.coefficientOrders?.map((source) => {
        const result = source.slice(),
          last = result.length - 1
        const a = result[last] ?? 0
        result[last] = result[last - 1] ?? 0
        result[last - 1] = a
        return result
      })
      if (!orders) throw new Error('Missing order families')
      return { ...rewritten, coefficientOrders: orders }
    },
  })
  assertTransplantDecisions(overrides, await extractDecisions(encoded.bytes))
}, 30_000)

it('replays small, rectangular and DCT64 decisions while preserving spatial samples', async () => {
  const width = 64,
    height = 64
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3
      ? 255
      : Math.round(
          80 +
            (i % 4) * 40 +
            12 * Math.sin((Math.floor(i / 4) % width) / 5) +
            8 * Math.cos(Math.floor(i / 4 / width) / 7),
        ),
  )
  const base = await extractDecisions((await encodeTransplant(pixels, width, height, 2, {})).bytes)
  for (const strategy of [2, 6, 7, 14, 15, 16, 17, 18, 19, 20]) {
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
      bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
    const decisions = {
      ...base,
      strategies: Array.from({ length: 64 }, () => strategy),
      strategyFirstBlocks: Array.from({ length: 64 }, (_, i) =>
        (i % 8) % bw === 0 && Math.floor(i / 8) % bh === 0 ? 1 : 0,
      ),
    }
    const overrides = transplantOverrides('strategy', decisions)
    const encoded = await encodeTransplant(pixels, width, height, 2, overrides)
    const actual = await extractDecisions(encoded.bytes)
    assertTransplantDecisions(overrides, actual)
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded.bytes),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Missing development decoder')
    let error = 0,
      samples = 0
    for await (const block of decoder.decode()) {
      try {
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++)
            for (let c = 0; c < 4; c++) {
              const a = block.data[y * block.stride + x * 4 + c] ?? 0
              const b = pixels[((block.y + y) * width + block.x + x) * 4 + c] ?? 0
              if (c === 3) expect(a).toBe(255)
              else {
                error += Math.abs(a - b)
                samples++
              }
            }
      } finally {
        block.release?.()
      }
    }
    expect(error / samples).toBeLessThan(5)
  }
}, 30_000)
