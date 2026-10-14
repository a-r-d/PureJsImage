import { allocationOverrides } from '../../benchmark/jpegxl/lossy-lab/allocation.ts'
import { extractDecisions } from '../../benchmark/jpegxl/lossy-lab/decisions.ts'
import { libjxlPortOverrides } from '../../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'
import {
  assertTransplantDecisions,
  encodeTransplant,
  transplantOverrides,
} from '../../benchmark/jpegxl/lossy-lab/transplant.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../src/codecs/jpegxl-vardct-jpeg.ts'

async function decodedReceipt(bytes: Uint8Array, component: string) {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (!decoder) throw new Error('Missing decoder')
  let checksum = 2166136261,
    samples = 0
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width * 4; x++) {
          const value = block.data[y * block.stride + x]
          if (value === undefined || (x % 4 === 3 && value !== 255))
            throw new Error('Incomplete color or alpha')
          checksum = Math.imul(checksum ^ value, 16777619)
          samples++
        }
    } finally {
      block.release?.()
    }
  }
  return { component, bytes: bytes.length, checksum: checksum >>> 0, samples }
}

export async function verifyDecisionTransplantBrowser() {
  const pixels = Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 17) % 256,
  )
  const control = await encodeTransplant(pixels, 32, 32, 2, {})
  const decisions = await extractDecisions(control.bytes)
  const forced = {
    ...decisions,
    globalScale: 4000,
    rawQuantization: Array.from({ length: 16 }, (_, i) => 4 + (i % 3)),
    gaborish: true,
    epfIterations: 3,
    sharpness: Array.from({ length: 16 }, (_, i) => i % 8),
  }
  const rows = []
  for (const smoothing of ['off', 'on'] as const) {
    const encoded = await encodeTransplant(
      pixels,
      32,
      32,
      2,
      allocationOverrides({ alpha: 0.5, acScale: 1.25, smoothing }, 2),
    )
    rows.push(await decodedReceipt(encoded.bytes, `allocation-${smoothing}`))
  }
  for (const component of ['control', 'quant', 'dc', 'cfl', 'filters', 'available'] as const) {
    const encoded = await encodeTransplant(
      pixels,
      32,
      32,
      2,
      transplantOverrides(component, forced),
    )
    rows.push(await decodedReceipt(encoded.bytes, component))
  }
  for (const [strategy, width] of [
    [6, 32],
    [14, 32],
    [18, 64],
  ]) {
    if (strategy === undefined || width === undefined) throw new Error('Missing browser footprint')
    const input = Uint8Array.from({ length: width * width * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : 100 + (i % 4) * 20 + Math.round(8 * Math.sin(Math.floor(i / 4) / 12)),
    )
    const base = await extractDecisions((await encodeTransplant(input, width, width, 2, {})).bytes)
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
      bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0,
      blocks = width / 8
    const d = {
      ...base,
      strategies: Array.from({ length: blocks * blocks }, () => strategy),
      strategyFirstBlocks: Array.from({ length: blocks * blocks }, (_, i) =>
        (i % blocks) % bw === 0 && Math.floor(i / blocks) % bh === 0 ? 1 : 0,
      ),
    }
    const overrides = transplantOverrides('strategy', d)
    const encoded = await encodeTransplant(input, width, width, 2, overrides)
    assertTransplantDecisions(overrides, await extractDecisions(encoded.bytes))
    rows.push(await decodedReceipt(encoded.bytes, `strategy-${strategy}`))
  }
  const patch = {
    referenceId: 3 as const,
    referenceX: 0,
    referenceY: 0,
    x: 4,
    y: 4,
    width: 2,
    height: 2,
    blendMode: 2,
    blending: [
      { mode: 2, alphaChannel: 0, clamp: false },
      { mode: 0, alphaChannel: 0, clamp: false },
    ],
  }
  const reference = {
    id: 3 as const,
    width: 2,
    height: 2,
    planes: [
      Int32Array.from([1, 2, 3, 4]),
      new Int32Array(4),
      new Int32Array(4),
      new Int32Array(4),
    ],
    dcQuantization: [1 / 1024, 1 / 512, 1 / 512] as const,
  }
  const overrides = transplantOverrides('all', {
    ...decisions,
    references: [reference],
    patches: [patch],
  })
  const encoded = await encodeTransplant(pixels, 32, 32, 2, overrides)
  assertTransplantDecisions(overrides, await extractDecisions(encoded.bytes))
  const actual = await extractDecisions(encoded.bytes, true)
  if (
    !actual.references?.every((r) =>
      r.planes.every((p, c) => p.every((v, i) => v === reference.planes[c]?.[i])),
    )
  )
    throw new Error('Browser reference samples differ')
  rows.push(await decodedReceipt(encoded.bytes, 'all-with-reference'))
  for (const component of [
    'strategy-quant',
    'strategy-quant-matrices',
    'strategy-quant-cfl',
    'strategy-quant-filters',
    'strategy-quant-dc',
    'strategy-quant-roundtrip',
    'strategy-quant-gaborish',
    'quant-port',
    'quant-port-filters',
    'quant-port-source',
    'quant-port-complete',
  ] as const) {
    const forced = transplantOverrides(component, decisions, 2)
    const output = await encodeTransplant(pixels, 32, 32, 2, forced)
    assertTransplantDecisions(forced, await extractDecisions(output.bytes))
    rows.push(await decodedReceipt(output.bytes, component))
  }
  for (const port of [
    'tiny',
    'own-roundtrip',
    'spatial-masked',
    'spatial-guarded',
    'spatial-actual-guarded',
    'gaborish',
    'gaborish-strategy',
    'dc',
    'dc-smooth',
    'standalone',
    'standalone-direct',
    'standalone-refined',
    'standalone-refined-dcfine-hfhalf',
    'standalone-refined-chroma75',
    'standalone-guard-bounded',
  ] as const) {
    const output = await encodeTransplant(pixels, 32, 32, 2, libjxlPortOverrides(port, 2, 32, 32))
    rows.push(await decodedReceipt(output.bytes, `port-${port}`))
  }
  return rows
}
