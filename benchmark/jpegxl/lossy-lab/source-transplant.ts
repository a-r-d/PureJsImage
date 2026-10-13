import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import { JpegXlEncoderMemory } from '../../../src/codecs/jpegxl-encoder-memory.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import type { TransplantDecisions } from './decisions.ts'

export function ownTransformDecisions(
  base: VarDctCoefficientGeometry,
  peer: TransplantDecisions,
): TransplantDecisions {
  const strategies = Array.from(
    base.strategyMap ?? new Int32Array(base.blocksWide * base.blocksHigh),
  )
  const first = new Uint8Array(strategies.length),
    covered = new Uint8Array(strategies.length)
  for (let y = 0; y < base.blocksHigh; y++)
    for (let x = 0; x < base.blocksWide; x++) {
      const at = y * base.blocksWide + x
      if (covered[at]) continue
      const s = strategies[at] ?? 0
      const bw = jpegXlVarDctStrategyBlockWidths[s] ?? 0,
        bh = jpegXlVarDctStrategyBlockHeights[s] ?? 0
      if (!bw || !bh || x + bw > base.blocksWide || y + bh > base.blocksHigh)
        throw new Error('Invalid own transform footprint')
      first[at] = 1
      for (let dy = 0; dy < bh; dy++)
        for (let dx = 0; dx < bw; dx++) covered[(y + dy) * base.blocksWide + x + dx] = 1
    }
  return { ...peer, strategies, strategyFirstBlocks: Array.from(first) }
}

/** Exact inverse of our decoder's signaled 3x3 filter, solved without imported heuristics. */
export function inverseDevelopmentGaborish(
  input: Float32Array,
  width: number,
  height: number,
  memory?: JpegXlEncoderMemory,
): Float32Array<ArrayBuffer> {
  const adjacent = 1.1 * 0.104699568,
    diagonal = 1.1 * 0.055680538
  const norm = 1 / (1 + 4 * (adjacent + diagonal))
  let current = memory
    ? memory.allocate(Float32Array, input.length)
    : new Float32Array(input.length)
  current.set(input)
  let next = memory ? memory.allocate(Float32Array, input.length) : new Float32Array(input.length)
  for (let iteration = 0; iteration < 32; iteration++) {
    let maximum = 0
    for (let y = 0; y < height; y++) {
      const row = y * width,
        top = Math.max(0, y - 1) * width,
        bottom = Math.min(height - 1, y + 1) * width
      for (let x = 0; x < width; x++) {
        const left = Math.max(0, x - 1),
          right = Math.min(width - 1, x + 1),
          at = row + x
        const filtered =
          norm *
          ((current[at] ?? 0) +
            adjacent *
              ((current[row + left] ?? 0) +
                (current[row + right] ?? 0) +
                (current[top + x] ?? 0) +
                (current[bottom + x] ?? 0)) +
            diagonal *
              ((current[top + left] ?? 0) +
                (current[top + right] ?? 0) +
                (current[bottom + left] ?? 0) +
                (current[bottom + right] ?? 0)))
        const residual = (input[at] ?? 0) - filtered
        maximum = Math.max(maximum, Math.abs(residual))
        next[at] = (current[at] ?? 0) + residual
      }
    }
    const previous = current
    current = next
    next = previous
    if (maximum <= 3e-8) break
  }
  memory?.release(next)
  return current
}

/** Full planes exist only in this development transplant, outside the production path. */
export function developmentSourceContext(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  d: TransplantDecisions,
  patches: boolean,
  gaborish: boolean,
): JpegXlDevelopmentTransformContext & { release(): void } {
  const width = d.width,
    height = d.height
  const memory = base.memory
  if (!memory) throw new Error('Missing development source memory ledger')
  let planes = Array.from({ length: 3 }, () => memory.allocate(Float32Array, width * height))
  for (let by = 0; by < base.blocksHigh; by++)
    for (let bx = 0; bx < base.blocksWide; bx++) {
      const block = context.readBlock(bx, by, false)
      for (let c = 0; c < 3; c++) {
        const target = planes[c],
          source = block[c]
        if (!target || !source) throw new Error('Missing development source plane')
        for (let y = 0; y < 8 && by * 8 + y < height; y++)
          for (let x = 0; x < 8 && bx * 8 + x < width; x++)
            target[(by * 8 + y) * width + bx * 8 + x] = source[y * 8 + x] ?? 0
      }
    }
  if (patches)
    // Undo decoder composition in reverse placement order, including overlap.
    for (let index = d.patches.length - 1; index >= 0; index--) {
      const patch = d.patches[index]
      if (!patch) throw new Error('Missing patch')
      const reference = d.references?.find((r) => r.id === patch.referenceId)
      if (!reference || patch.blendMode !== 2)
        throw new Error('Development residual requires additive XYB patches')
      if (
        patch.referenceX + patch.width > reference.width ||
        patch.referenceY + patch.height > reference.height ||
        patch.x + patch.width > width ||
        patch.y + patch.height > height
      )
        throw new Error('Development patch exceeds its reference or output extent')
      const xPlane = planes[0],
        yPlane = planes[1],
        bPlane = planes[2]
      if (!xPlane || !yPlane || !bPlane) throw new Error('Missing patch residual plane')
      const values = reference.planes,
        q = reference.dcQuantization
      for (let y = 0; y < patch.height; y++)
        for (let x = 0; x < patch.width; x++) {
          const from = (patch.referenceY + y) * reference.width + patch.referenceX + x,
            to = (patch.y + y) * width + patch.x + x
          const refY = (values[0]?.[from] ?? 0) * q[1],
            refX = (values[1]?.[from] ?? 0) * q[0],
            refB = ((values[2]?.[from] ?? 0) + (values[0]?.[from] ?? 0)) * q[2] - refY
          xPlane[to] = (xPlane[to] ?? 0) - refX
          yPlane[to] = (yPlane[to] ?? 0) - refY
          bPlane[to] = (bPlane[to] ?? 0) - refB
        }
    }
  if (gaborish)
    planes = planes.map((p) => {
      const result = inverseDevelopmentGaborish(p, width, height, memory)
      memory.release(p)
      return result
    })
  const block = Array.from({ length: 3 }, () => memory.allocate(Float32Array, 64))
  return {
    release: () => {
      for (const p of [...planes, ...block]) memory.release(p)
    },
    quantize: context.quantize,
    readBlock: (bx, by, correlated) => {
      if (correlated) context.readBlock(bx, by, true)
      for (let c = 0; c < 3; c++) {
        const source = planes[c],
          target = block[c]
        if (!source || !target) throw new Error('Missing development source block')
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++)
            target[y * 8 + x] =
              source[Math.min(height - 1, by * 8 + y) * width + Math.min(width - 1, bx * 8 + x)] ??
              0
      }
      return block
    },
  }
}
