import { encodeHybridUintPacked, packSigned } from './jpegxl-modular-encode.ts'
import type { JpegXlEncoderMemory } from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
const frequencyContext = new Uint16Array([
  0xbad, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19,
  20, 20, 21, 21, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25, 25, 25, 26, 26, 26, 26, 27, 27,
  27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30, 30, 30, 30,
])
const nonzeroContext = new Uint16Array([
  0xbad, 0, 31, 62, 62, 93, 93, 93, 93, 123, 123, 123, 123, 152, 152, 152, 152, 152, 152, 152, 152,
  180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 206, 206, 206, 206, 206, 206, 206,
  206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206,
  206, 206, 206, 206, 206,
])
const config = { splitExponent: 3, msbInToken: 1, lsbInToken: 0 },
  contexts = 458,
  tokens = 32
const validTokens = new Uint8Array(tokens)
let tokenPopulation = 0
// Initialize after the codec module graph has finished loading.
function initializeTokens(): void {
  if (tokenPopulation !== 0) return
  for (let packed = 1; packed <= 8190; packed++)
    validTokens[encodeHybridUintPacked(packed, config) & 255] = 1
  for (let token = 0; token < tokens; token++) tokenPopulation += validTokens[token] ?? 0
}
function requireValue(condition: boolean, message: string): void {
  if (!condition) throw invalidJpegXlInput(message)
}
/** First-pass frozen source model. COUNT/DC are separate. No per-block allocation. */
export function createCoherentCoefficientModel(memory: JpegXlEncoderMemory) {
  initializeTokens()
  const held: ArrayBufferView[] = []
  try {
    const support = memory.allocate(Uint32Array, 3 * contexts * 2)
    held.push(support)
    const magnitudes = memory.allocate(Uint32Array, 3 * contexts * tokens)
    held.push(magnitudes)
    const backoff = memory.allocate(Uint32Array, 3 * (tokens + 2))
    held.push(backoff)
    const costs = memory.allocate(Float64Array, 3 * contexts * (tokens + 2))
    held.push(costs)
    let frozen = false,
      released = false
    const visit = (
      values: Int16Array,
      order: Uint32Array,
      area: number,
      b: number,
      offset: number,
      learn: boolean,
      out: Float64Array,
    ): void => {
      requireValue(
        !released &&
          (area === 1 || area === 4 || area === 8 || area === 16) &&
          Number.isInteger(b) &&
          b >= 0 &&
          b < 3 &&
          Number.isInteger(offset) &&
          offset >= 0 &&
          offset + order.length <= values.length &&
          order.length === 64 * area &&
          out.length >= 6,
        'Invalid coherent coefficient extent',
      )
      let last = area - 1,
        nonzero = 0
      for (let scan = area; scan < order.length; scan++) {
        const p = order[scan] ?? -1
        requireValue(p >= 0 && p < order.length, 'Invalid coherent coefficient order')
        const v = values[offset + p] ?? 0
        requireValue(Math.abs(v) <= 4095, 'Coherent coefficient range')
        if (v !== 0) {
          last = scan
          nonzero++
        }
      }
      let remaining = nonzero,
        previous = nonzero > order.length / 16 ? 0 : 1,
        supportBits = 0,
        tokenBits = 0,
        extraBits = 0
      for (let scan = area; scan <= last; scan++) {
        const value = values[offset + (order[scan] ?? 0)] ?? 0,
          context =
            ((nonzeroContext[Math.ceil(remaining / area)] ?? 0) +
              (frequencyContext[Math.floor(scan / area)] ?? 0)) *
              2 +
            previous
        requireValue(context >= 0 && context < contexts, 'Invalid coherent coefficient context')
        const at = b * contexts + context,
          isNonzero = value === 0 ? 0 : 1,
          packed = encodeHybridUintPacked(packSigned(value), config),
          token = packed & 255,
          extra = (packed >>> 8) & 31
        if (learn) {
          const n = support[at * 2 + isNonzero] ?? 0
          requireValue(n < 0xffffffff, 'Coherent histogram overflow')
          support[at * 2 + isNonzero] = n + 1
          const base = b * (tokens + 2),
            count = backoff[base + isNonzero] ?? 0
          requireValue(count < 0xffffffff, 'Coherent histogram overflow')
          backoff[base + isNonzero] = count + 1
          if (isNonzero) {
            requireValue(validTokens[token] === 1, 'Invalid coherent nonzero token')
            magnitudes[at * tokens + token] = (magnitudes[at * tokens + token] ?? 0) + 1
            backoff[base + 2 + token] = (backoff[base + 2 + token] ?? 0) + 1
          }
        } else {
          const p = at * (tokens + 2)
          supportBits += costs[p + isNonzero] ?? 0
          if (isNonzero) {
            tokenBits += costs[p + 2 + token] ?? 0
            extraBits += extra
          }
        }
        previous = isNonzero
        remaining -= isNonzero
      }
      requireValue(remaining === 0, 'Incomplete coherent coefficient support')
      out[0] = supportBits + tokenBits + extraBits
      out[1] = supportBits
      out[2] = tokenBits
      out[3] = extraBits
      out[4] = last - area + 1
      out[5] = nonzero
    }
    return {
      byteLength: held.reduce((n, a) => n + a.byteLength, 0),
      learn(
        values: Int16Array,
        order: Uint32Array,
        area: number,
        blockContext: number,
        offset: number,
        scratch: Float64Array,
      ): void {
        requireValue(!frozen, 'Coherent model already frozen')
        visit(values, order, area, blockContext, offset, true, scratch)
      },
      freeze(): void {
        requireValue(!released && !frozen, 'Coherent model lifecycle')
        for (let b = 0; b < 3; b++) {
          const base = b * (tokens + 2),
            zero = backoff[base] ?? 0,
            nz = backoff[base + 1] ?? 0,
            priorNonzero = (nz + 1) / (zero + nz + 2)
          for (let c = 0; c < contexts; c++) {
            const at = b * contexts + c,
              z = support[at * 2] ?? 0,
              n = support[at * 2 + 1] ?? 0,
              p = at * (tokens + 2),
              probability = (n + priorNonzero) / (z + n + 1)
            costs[p] = -Math.log2(1 - probability)
            costs[p + 1] = -Math.log2(probability)
            for (let t = 1; t < tokens; t++)
              if (validTokens[t]) {
                const prior = ((backoff[base + 2 + t] ?? 0) + 1) / (nz + tokenPopulation)
                costs[p + 2 + t] = -Math.log2(
                  ((magnitudes[at * tokens + t] ?? 0) + prior) / (n + 1),
                )
              }
          }
        }
        frozen = true
      },
      estimateInto(
        values: Int16Array,
        order: Uint32Array,
        area: number,
        blockContext: number,
        offset: number,
        out: Float64Array,
      ): void {
        requireValue(frozen, 'Coherent model is not frozen')
        visit(values, order, area, blockContext, offset, false, out)
      },
      release(): void {
        if (!released) {
          released = true
          for (const a of held) memory.release(a)
        }
      },
    }
  } catch (error) {
    for (const a of held) memory.release(a)
    throw error
  }
}
export type CoherentCoefficientModel = ReturnType<typeof createCoherentCoefficientModel>
/** Canonical natural orders copied from the maintained first-party writer. */
export function createNaturalLargeOrder(memory: JpegXlEncoderMemory, rows: 2 | 4): Uint32Array {
  const width = 32,
    rowScale = 4 / rows,
    size = rows * 4 * 64,
    order = memory.allocate(Uint32Array, size)
  let next = rows * 4
  for (let diagonal = 0; diagonal < width; diagonal++)
    for (let step = 0; step <= diagonal; step++) {
      let x = step,
        y = diagonal - step
      if ((diagonal & 1) !== 0) {
        const temporary = x
        x = y
        y = temporary
      }
      if (y % rowScale !== 0) continue
      y /= rowScale
      const scan = x < 4 && y < rows ? y * 4 + x : next++
      order[scan] = y * width + x
    }
  for (let reverse = width - 1; reverse > 0; reverse--) {
    const diagonal = reverse - 1
    for (let step = 0; step <= diagonal; step++) {
      let x = width - 1 - (diagonal - step),
        y = width - 1 - step
      if ((diagonal & 1) !== 0) {
        const temporary = x
        x = y
        y = temporary
      }
      if (y % rowScale !== 0) continue
      y /= rowScale
      order[next++] = y * width + x
    }
  }
  requireValue(next === size, 'Incomplete coherent natural large order')
  return order
}
