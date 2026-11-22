/**
 * Sources: libjxl lib/jxl/enc_gaborish.cc (inverse Gaborish weights) and
 * lib/jxl/enc_adaptive_quantization.cc (Laplacian and Blur1x1Masking), v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript on 8x8 XYB blocks from our encoder. The inverse
 * Gaborish prefilter convolves a 12x12 block halo with clamped borders. The
 * selector mask covers one 64x64 tile plus a three-pixel halo. All scratch is
 * bounded independently of image area and comes from the encoder memory ledger.
 * Forward transforms invert our decoder's normative inverse transforms; the
 * forward and inverse rectangle kernels share mirrored samples. First-party.
 */
import type { JpegXlEncoderMemory } from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
import type { JpegXlBlockSource } from './jpegxl-libjxl-quant-field.ts'
import {
  jpegXlVarDctStrategyBlockHeights,
  jpegXlVarDctStrategyBlockWidths,
} from './jpegxl-vardct-jpeg.ts'
import { inverseJpegXlTransform } from './jpegxl-vardct-render.ts'

const bases = new Map<number, Float64Array>()
const dctBasis = (size: number): Float64Array => {
  const cached = bases.get(size)
  if (cached) return cached
  const basis = new Float64Array(size * size)
  for (let k = 0; k < size; k++)
    for (let x = 0; x < size; x++)
      basis[k * size + x] =
        Math.sqrt(2 / size) *
        (k === 0 ? Math.SQRT1_2 : 1) *
        Math.cos(((2 * x + 1) * k * Math.PI) / (2 * size))
  bases.set(size, basis)
  return basis
}

const mixDc = (coefficients: Float64Array): void => {
  const a = coefficients[0] ?? 0,
    b = coefficients[1] ?? 0,
    c = coefficients[8] ?? 0,
    d = coefficients[9] ?? 0
  coefficients[0] = (a + b + c + d) / 4
  coefficients[1] = (a + b - c - d) / 4
  coefficients[8] = (a - b + c - d) / 4
  coefficients[9] = (a - b - c + d) / 4
}

/** DCT8 (0), Hornuss (1), DCT2 (2) and DCT4 (3) forward transforms of one 8x8 block. */
const forwardSmallTransform = (
  strategy: number,
  pixels: Float32Array,
  scratch: Float64Array,
  coefficients: Float64Array,
): void => {
  if (strategy === 1) {
    for (let cy = 0; cy < 2; cy++)
      for (let cx = 0; cx < 2; cx++) {
        const origin = cy * 32 + cx * 4
        const center = pixels[origin + 9] ?? 0
        let sum = 0
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const sample = pixels[origin + y * 8 + x] ?? 0
            sum += sample
            coefficients[(cy + y * 2) * 8 + cx + x * 2] =
              y === 1 && x === 1 ? (pixels[origin] ?? 0) - center : sample - center
          }
        coefficients[cy * 8 + cx] = sum / 16
      }
    mixDc(coefficients)
    return
  }
  if (strategy === 2) {
    for (let i = 0; i < 64; i++) coefficients[i] = pixels[i] ?? 0
    for (let size = 8; size >= 2; size /= 2) {
      const half = size / 2
      for (let y = 0; y < half; y++)
        for (let x = 0; x < half; x++) {
          const at = y * 16 + x * 2
          const a = coefficients[at] ?? 0,
            b = coefficients[at + 1] ?? 0,
            c = coefficients[at + 8] ?? 0,
            d = coefficients[at + 9] ?? 0
          scratch[y * 8 + x] = (a + b + c + d) / 4
          scratch[y * 8 + half + x] = (a + b - c - d) / 4
          scratch[(y + half) * 8 + x] = (a - b + c - d) / 4
          scratch[(y + half) * 8 + half + x] = (a - b - c + d) / 4
        }
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) coefficients[y * 8 + x] = scratch[y * 8 + x] ?? 0
    }
    return
  }
  if (strategy !== 0 && strategy !== 3)
    throw invalidJpegXlInput('libjxl selector transform is unsupported')
  const size = strategy === 3 ? 4 : 8
  const basis = dctBasis(size)
  const scale = 1 / Math.sqrt(size * size)
  for (let oy = 0; oy < 8; oy += size)
    for (let ox = 0; ox < 8; ox += size) {
      for (let y = 0; y < size; y++) {
        const source = (oy + y) * 8 + ox,
          target = y * size
        for (let h = 0; h < size; h += 4) {
          let a = 0,
            b = 0,
            c = 0,
            d = 0
          const k0 = h * size,
            k1 = k0 + size,
            k2 = k1 + size,
            k3 = k2 + size
          for (let x = 0; x < size; x++) {
            const value = pixels[source + x] ?? 0
            a += value * (basis[k0 + x] ?? 0)
            b += value * (basis[k1 + x] ?? 0)
            c += value * (basis[k2 + x] ?? 0)
            d += value * (basis[k3 + x] ?? 0)
          }
          scratch[target + h] = a
          scratch[target + h + 1] = b
          scratch[target + h + 2] = c
          scratch[target + h + 3] = d
        }
      }
      for (let h = 0; h < size; h++)
        for (let v = 0; v < size; v += 4) {
          let a = 0,
            b = 0,
            c = 0,
            d = 0
          const k0 = v * size,
            k1 = k0 + size,
            k2 = k1 + size,
            k3 = k2 + size
          for (let y = 0, at = h; y < size; y++, at += size) {
            const value = scratch[at] ?? 0
            a += value * (basis[k0 + y] ?? 0)
            b += value * (basis[k1 + y] ?? 0)
            c += value * (basis[k2 + y] ?? 0)
            d += value * (basis[k3 + y] ?? 0)
          }
          // DCT8 stores transposed coefficients; DCT4 interleaves its four quadrants.
          const at = strategy === 0 ? h * 8 + v : (oy / 4 + h * 2) * 8 + ox / 4 + v * 2
          const step = strategy === 0 ? 1 : 2
          coefficients[at] = a * scale
          coefficients[at + step] = b * scale
          coefficients[at + 2 * step] = c * scale
          coefficients[at + 3 * step] = d * scale
        }
    }
  if (strategy === 3) mixDc(coefficients)
}

/** Forward transform for every selector strategy; rectangles reuse mirrored input sums. */
export const forwardJpegXlLibjxlTransform = (
  strategy: number,
  pixels: Float32Array,
  scratch: Float64Array,
  coefficients: Float64Array,
  pairs: Float64Array,
): void => {
  const width = (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) * 8
  const height = (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0) * 8
  if (width === 8 && height === 8) {
    forwardSmallTransform(strategy, pixels, scratch, coefficients)
    return
  }
  if (width < 8 || height < 8 || width > 64 || height > 64 || pairs.length < 64)
    throw invalidJpegXlInput('libjxl paired transform extent is invalid')
  const horizontal = dctBasis(width),
    vertical = dctBasis(height)
  const scale = 1 / Math.sqrt(width * height)
  const halfWidth = width / 2,
    halfHeight = height / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < halfWidth; x++) {
      const a = pixels[y * width + x] ?? 0,
        b = pixels[y * width + width - 1 - x] ?? 0
      pairs[x] = a + b
      pairs[halfWidth + x] = a - b
    }
    for (let h = 0; h < width; h += 4) {
      let s0 = 0,
        s1 = 0,
        s2 = 0,
        s3 = 0
      const at = h * width
      for (let x = 0; x < halfWidth; x++) {
        const even = pairs[x] ?? 0,
          odd = pairs[halfWidth + x] ?? 0
        s0 += even * (horizontal[at + x] ?? 0)
        s1 += odd * (horizontal[at + width + x] ?? 0)
        s2 += even * (horizontal[at + 2 * width + x] ?? 0)
        s3 += odd * (horizontal[at + 3 * width + x] ?? 0)
      }
      scratch[y * width + h] = s0
      scratch[y * width + h + 1] = s1
      scratch[y * width + h + 2] = s2
      scratch[y * width + h + 3] = s3
    }
  }
  for (let h = 0; h < width; h++) {
    for (let y = 0; y < halfHeight; y++) {
      const a = scratch[y * width + h] ?? 0,
        b = scratch[(height - 1 - y) * width + h] ?? 0
      pairs[y] = a + b
      pairs[halfHeight + y] = a - b
    }
    for (let v = 0; v < height; v += 4) {
      let s0 = 0,
        s1 = 0,
        s2 = 0,
        s3 = 0
      const at = v * height
      for (let y = 0; y < halfHeight; y++) {
        const even = pairs[y] ?? 0,
          odd = pairs[halfHeight + y] ?? 0
        s0 += even * (vertical[at + y] ?? 0)
        s1 += odd * (vertical[at + height + y] ?? 0)
        s2 += even * (vertical[at + 2 * height + y] ?? 0)
        s3 += odd * (vertical[at + 3 * height + y] ?? 0)
      }
      const out = height >= width ? h * height + v : v * width + h
      const step = height >= width ? 1 : width
      coefficients[out] = s0 * scale
      coefficients[out + step] = s1 * scale
      coefficients[out + 2 * step] = s2 * scale
      coefficients[out + 3 * step] = s3 * scale
    }
  }
}

const inverseWeights = new Map<number, Float64Array>()
const inverseWeightTable = (size: number): Float64Array => {
  const previous = inverseWeights.get(size)
  if (previous) return previous
  const forward = dctBasis(size)
  const result = new Float64Array((size * size) / 2)
  for (let x = 0; x < size / 2; x++)
    for (let k = 0; k < size; k++) result[x * size + k] = forward[k * size + x] ?? 0
  inverseWeights.set(size, result)
  return result
}

/** Inverse transform; rectangles use cached weights in dot-product order. */
export const inverseJpegXlLibjxlTransform = (
  strategy: number,
  coefficients: Float64Array,
  scratch: Float64Array,
  destination: Float32Array,
  active: Uint16Array,
): void => {
  const width = (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) * 8
  const height = (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0) * 8
  if (width === 8 && height === 8) {
    inverseJpegXlTransform(strategy, coefficients, scratch, destination, active)
    return
  }
  if (width < 8 || height < 8 || width > 64 || height > 64)
    throw invalidJpegXlInput('libjxl inverse transform extent is invalid')
  const horizontal = inverseWeightTable(width),
    vertical = inverseWeightTable(height),
    stride = height >= width ? height : 1,
    pairStride = 2 * stride,
    scale = Math.sqrt(width * height)
  for (let v = 0; v < height; v++) {
    const row = height >= width ? v : v * width
    for (let x = 0; x < width / 2; x++) {
      let even = 0,
        odd = 0,
        at = row
      const offset = x * width
      for (let h = 0; h < width; h += 2) {
        even += (coefficients[at] ?? 0) * (horizontal[offset + h] ?? 0)
        odd += (coefficients[at + stride] ?? 0) * (horizontal[offset + h + 1] ?? 0)
        at += pairStride
      }
      scratch[v * width + x] = even + odd
      scratch[v * width + width - 1 - x] = even - odd
    }
  }
  for (let y = 0; y < height / 2; y++) {
    const offset = y * height
    for (let x = 0; x < width; x += 4) {
      let e0 = 0,
        o0 = 0,
        e1 = 0,
        o1 = 0,
        e2 = 0,
        o2 = 0,
        e3 = 0,
        o3 = 0,
        at = x
      for (let v = 0; v < height; v += 2) {
        const e = vertical[offset + v] ?? 0,
          o = vertical[offset + v + 1] ?? 0,
          odd = at + width
        e0 += (scratch[at] ?? 0) * e
        o0 += (scratch[odd] ?? 0) * o
        e1 += (scratch[at + 1] ?? 0) * e
        o1 += (scratch[odd + 1] ?? 0) * o
        e2 += (scratch[at + 2] ?? 0) * e
        o2 += (scratch[odd + 2] ?? 0) * o
        e3 += (scratch[at + 3] ?? 0) * e
        o3 += (scratch[odd + 3] ?? 0) * o
        at += 2 * width
      }
      const top = y * width + x,
        bottom = (height - 1 - y) * width + x
      destination[top] = (e0 + o0) * scale
      destination[bottom] = (e0 - o0) * scale
      destination[top + 1] = (e1 + o1) * scale
      destination[bottom + 1] = (e1 - o1) * scale
      destination[top + 2] = (e2 + o2) * scale
      destination[bottom + 2] = (e2 - o2) * scale
      destination[top + 3] = (e3 + o3) * scale
      destination[bottom + 3] = (e3 - o3) * scale
    }
  }
}

const lfScales = new Map<number, Float64Array>()
const inverseLfScales = (size: number): Float64Array => {
  const cached = lfScales.get(size)
  if (cached) return cached
  const values = new Float64Array(size)
  for (let k = 0; k < size; k++)
    values[k] =
      Math.cos((k * Math.PI) / (size * 16)) *
      Math.cos((k * Math.PI) / (size * 8)) *
      Math.cos((k * Math.PI) / (size * 4))
  lfScales.set(size, values)
  return values
}

/** Recover the compact DC grid whose normative upsampling produces these low frequencies. */
export const jpegXlLibjxlDcGrid = (
  coefficients: Float64Array,
  bw: number,
  bh: number,
  output: Float64Array,
): void => {
  const hx = dctBasis(bw),
    vy = dctBasis(bh),
    scale = Math.sqrt(bw * bh)
  const horizontalScales = inverseLfScales(bw),
    verticalScales = inverseLfScales(bh)
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let sum = 0
      for (let v = 0; v < bh; v++)
        for (let h = 0; h < bw; h++) {
          const index = bh >= bw ? h * bh * 8 + v : v * bw * 8 + h
          sum +=
            (coefficients[index] ?? 0) *
            (horizontalScales[h] ?? 0) *
            (verticalScales[v] ?? 0) *
            (hx[h * bw + x] ?? 0) *
            (vy[v * bh + y] ?? 0)
        }
      output[y * bw + x] = sum * scale
    }
}

export type ReleasableJpegXlBlockSource = JpegXlBlockSource & { release(): void }

/** Caches uncorrelated reads in one ring that covers a 64-pixel tile plus its halo. */
const gaborishSourceCache = (
  source: JpegXlBlockSource,
  memory: JpegXlEncoderMemory,
): ReleasableJpegXlBlockSource => {
  const storage = memory.allocate(Float32Array, 30 * 192)
  const xs = memory.allocate(Int32Array, 30)
  const ys = memory.allocate(Int32Array, 30)
  xs.fill(-1)
  ys.fill(-1)
  const blocks = Array.from({ length: 30 }, (_, i) => [
    storage.subarray(i * 192, i * 192 + 64),
    storage.subarray(i * 192 + 64, i * 192 + 128),
    storage.subarray(i * 192 + 128, i * 192 + 192),
  ])
  return {
    quantize: source.quantize,
    zeroQuantizationThresholds: source.zeroQuantizationThresholds,
    release(): void {
      memory.release(storage)
      memory.release(xs)
      memory.release(ys)
    },
    readBlock(x, y, correlated) {
      // Correlated reads also update the encoder's activity-dependent quantizer.
      if (correlated) return source.readBlock(x, y, true)
      const index = (y % 3) * 10 + (x % 10)
      const target = blocks[index]
      if (!target) throw invalidJpegXlInput('libjxl Gaborish cache block is missing')
      if (xs[index] !== x || ys[index] !== y) {
        const block = source.readBlock(x, y, false)
        for (let c = 0; c < 3; c++) {
          const from = block[c],
            to = target[c]
          if (!from || !to) throw invalidJpegXlInput('libjxl Gaborish cache plane is missing')
          to.set(from)
        }
        xs[index] = x
        ys[index] = y
      }
      return target
    },
  }
}

/**
 * Serves inverse-Gaborish-filtered blocks so the decoder's Gaborish restores the source.
 * `strength` scales the inverse weights as libjxl's GaborishInverse multiplier does, to
 * match a decoder filter whose weights are scaled by the same factor.
 */
export const jpegXlInverseGaborishSource = (
  source: JpegXlBlockSource,
  blocksWide: number,
  blocksHigh: number,
  width: number,
  height: number,
  memory: JpegXlEncoderMemory,
  strength = 1,
): ReleasableJpegXlBlockSource => {
  const adjacent = strength * -0.09495815671340026,
    diagonal = strength * -0.041031725066768575
  const farAxis = strength * 0.013710004822696948,
    mixed = strength * 0.006510206083837737,
    farDiagonal = strength * -0.0014789063378272242
  const gaborishNorm = 1 / (1 + 4 * (adjacent + diagonal + farAxis + farDiagonal + 2 * mixed))
  const sourceCache = gaborishSourceCache(source, memory)
  const halo = [
    memory.allocate(Float32Array, 144),
    memory.allocate(Float32Array, 144),
    memory.allocate(Float32Array, 144),
  ]
  const output = [
    memory.allocate(Float32Array, 64),
    memory.allocate(Float32Array, 64),
    memory.allocate(Float32Array, 64),
  ]
  let cachedX = -1,
    cachedY = -1
  return {
    quantize: source.quantize,
    zeroQuantizationThresholds: source.zeroQuantizationThresholds,
    release: () => {
      for (const buffer of [...halo, ...output]) memory.release(buffer)
      sourceCache.release()
    },
    readBlock: (bx, by, correlated) => {
      if (bx === cachedX && by === cachedY) {
        if (correlated) sourceCache.readBlock(bx, by, true)
        return output
      }
      const left = bx * 8 - 2,
        top = by * 8 - 2,
        lastBlockX = Math.floor((width - 1) / 8),
        lastBlockY = Math.floor((height - 1) / 8)
      for (let sy = Math.max(0, by - 1); sy <= Math.min(blocksHigh - 1, by + 1); sy++) {
        const y0 = sy === 0 ? 0 : Math.max(0, sy * 8 - top),
          y1 = sy === lastBlockY ? 12 : Math.min(12, (sy + 1) * 8 - top)
        for (let sx = Math.max(0, bx - 1); sx <= Math.min(blocksWide - 1, bx + 1); sx++) {
          const block = sourceCache.readBlock(sx, sy, false)
          if (sy > lastBlockY || sx > lastBlockX) continue
          const x0 = sx === 0 ? 0 : Math.max(0, sx * 8 - left),
            x1 = sx === lastBlockX ? 12 : Math.min(12, (sx + 1) * 8 - left),
            sourceX = left - sx * 8,
            sourceY = top - sy * 8,
            lastX = Math.min(7, width - 1 - sx * 8),
            lastY = Math.min(7, height - 1 - sy * 8),
            [px, py, pb] = block,
            [hx, hy, hb] = halo
          if (!px || !py || !pb || !hx || !hy || !hb)
            throw invalidJpegXlInput('libjxl Gaborish source plane is missing')
          for (let y = y0; y < y1; y++) {
            const row = 8 * Math.max(0, Math.min(lastY, sourceY + y)),
              toRow = 12 * y
            for (let x = x0; x < x1; x++) {
              const from = row + Math.max(0, Math.min(lastX, sourceX + x)),
                to = toRow + x
              hx[to] = px[from] ?? 0
              hy[to] = py[from] ?? 0
              hb[to] = pb[from] ?? 0
            }
          }
        }
      }
      for (let c = 0; c < 3; c++) {
        const halfPlane = halo[c],
          target = output[c]
        if (!halfPlane || !target) throw invalidJpegXlInput('libjxl Gaborish output is missing')
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            // Keep the 25 taps in row order; the sum is not reassociated.
            let sum = 0
            const at = y * 12 + x
            sum += farDiagonal * (halfPlane[at + 0] ?? 0)
            sum += mixed * (halfPlane[at + 1] ?? 0)
            sum += farAxis * (halfPlane[at + 2] ?? 0)
            sum += mixed * (halfPlane[at + 3] ?? 0)
            sum += farDiagonal * (halfPlane[at + 4] ?? 0)
            sum += mixed * (halfPlane[at + 12] ?? 0)
            sum += diagonal * (halfPlane[at + 13] ?? 0)
            sum += adjacent * (halfPlane[at + 14] ?? 0)
            sum += diagonal * (halfPlane[at + 15] ?? 0)
            sum += mixed * (halfPlane[at + 16] ?? 0)
            sum += farAxis * (halfPlane[at + 24] ?? 0)
            sum += adjacent * (halfPlane[at + 25] ?? 0)
            sum += 1 * (halfPlane[at + 26] ?? 0)
            sum += adjacent * (halfPlane[at + 27] ?? 0)
            sum += farAxis * (halfPlane[at + 28] ?? 0)
            sum += mixed * (halfPlane[at + 36] ?? 0)
            sum += diagonal * (halfPlane[at + 37] ?? 0)
            sum += adjacent * (halfPlane[at + 38] ?? 0)
            sum += diagonal * (halfPlane[at + 39] ?? 0)
            sum += mixed * (halfPlane[at + 40] ?? 0)
            sum += farDiagonal * (halfPlane[at + 48] ?? 0)
            sum += mixed * (halfPlane[at + 49] ?? 0)
            sum += farAxis * (halfPlane[at + 50] ?? 0)
            sum += mixed * (halfPlane[at + 51] ?? 0)
            sum += farDiagonal * (halfPlane[at + 52] ?? 0)
            target[y * 8 + x] = sum * gaborishNorm
          }
      }
      // Preserve the encoder's activity state for its rate-aware quantizer.
      if (correlated) sourceCache.readBlock(bx, by, true)
      cachedX = bx
      cachedY = by
      return output
    },
  }
}

/** Caches one 64x64 color tile of uncorrelated reads, independent of image area. */
export const jpegXlSelectorTileCache = (
  source: JpegXlBlockSource,
  memory: JpegXlEncoderMemory,
): ReleasableJpegXlBlockSource => {
  const storage = memory.allocate(Float32Array, 64 * 64 * 3)
  const present = memory.allocate(Uint8Array, 64)
  const blocks = Array.from({ length: 64 }, (_, i) => [
    storage.subarray(i * 192, i * 192 + 64),
    storage.subarray(i * 192 + 64, i * 192 + 128),
    storage.subarray(i * 192 + 128, i * 192 + 192),
  ])
  let tileX = -1,
    tileY = -1
  return {
    quantize: source.quantize,
    zeroQuantizationThresholds: source.zeroQuantizationThresholds,
    release: () => {
      memory.release(storage)
      memory.release(present)
    },
    readBlock: (x, y, correlated) => {
      if (correlated) return source.readBlock(x, y, true)
      const tx = Math.floor(x / 8),
        ty = Math.floor(y / 8)
      if (tx !== tileX || ty !== tileY) {
        present.fill(0)
        tileX = tx
        tileY = ty
      }
      const index = (y % 8) * 8 + (x % 8)
      const target = blocks[index]
      if (!target) throw invalidJpegXlInput('libjxl selector cache block is missing')
      if (!present[index]) {
        const block = source.readBlock(x, y, false)
        for (let c = 0; c < 3; c++) {
          const from = block[c],
            to = target[c]
          if (!from || !to) throw invalidJpegXlInput('libjxl selector cache plane is missing')
          to.set(from)
        }
        present[index] = 1
      }
      return target
    },
  }
}

/** Per-pixel masking for one 64x64 selector tile, from unfiltered source luma. */
export const jpegXlSelectorTileMask = (
  source: JpegXlBlockSource,
  blocksWide: number,
  blocksHigh: number,
  memory: JpegXlEncoderMemory,
) => {
  const width = blocksWide * 8,
    height = blocksHigh * 8
  const luma = memory.allocate(Float32Array, 70 * 70)
  const raw = memory.allocate(Float32Array, 68 * 68)
  const data = memory.allocate(Float32Array, 64 * 64)
  const numeratorMul = ((18.6580932135 * Math.LN2) / 73.377132366608819) * 3 * 226.77216153508914
  const denominatorMul = Math.LN2 * 226.77216153508914
  const offset = 7.7825991679894591 * Math.LN2 + 0.01
  const near = 0.364911248,
    corner = 0.05,
    far = 0.1688888021,
    knight = 0.221069183,
    farCorner = 0.306563504
  const normalization = 1 / (1 + 4 * (near + corner + far + farCorner + 2 * knight))
  const kernel = Float64Array.of(1, near, far, near, corner, knight, far, knight, farCorner)
  return {
    data,
    fill(blockX: number, blockY: number): void {
      const originX = blockX * 8,
        originY = blockY * 8
      // Copy each intersecting block once. readBlock returns reusable scratch.
      for (let by = Math.floor((originY - 3) / 8); by <= Math.floor((originY + 66) / 8); by++)
        for (let bx = Math.floor((originX - 3) / 8); bx <= Math.floor((originX + 66) / 8); bx++) {
          const block = source.readBlock(
            Math.max(0, Math.min(blocksWide - 1, bx)),
            Math.max(0, Math.min(blocksHigh - 1, by)),
            false,
          )[1]
          if (!block) throw invalidJpegXlInput('libjxl tile mask luma is missing')
          for (let y = Math.max(originY - 3, by * 8); y < Math.min(originY + 67, by * 8 + 8); y++)
            for (let x = Math.max(originX - 3, bx * 8); x < Math.min(originX + 67, bx * 8 + 8); x++)
              luma[(y - originY + 3) * 70 + x - originX + 3] =
                block[
                  (Math.max(0, Math.min(height - 1, y)) % 8) * 8 +
                    (Math.max(0, Math.min(width - 1, x)) % 8)
                ] ?? 0
        }
      for (let y = 0; y < 68; y++)
        for (let x = 0; x < 68; x++) {
          // Clamp the Laplacian center before reading its neighbors. Clamping
          // raw-mask coordinates is not the same as differentiating padding.
          const px = Math.max(0, Math.min(width - 1, originX + x - 2)) - originX + 3
          const py = Math.max(0, Math.min(height - 1, originY + y - 2)) - originY + 3
          const at = py * 70 + px,
            value = luma[at] ?? 0
          const average =
            0.25 *
            ((luma[at - 70] ?? 0) +
              (luma[at + 70] ?? 0) +
              (luma[at - 1] ?? 0) +
              (luma[at + 1] ?? 0))
          const v = Math.max(0, value + 0.019)
          const gamma = (denominatorMul * v * v * v + offset) / (numeratorMul * v * v + 0.01)
          raw[y * 68 + x] = 1 / (Math.log1p(Math.abs(gamma * (value - average))) + 0.01)
        }
      for (let y = 0; y < Math.min(64, height - originY); y++)
        for (let x = 0; x < Math.min(64, width - originX); x++) {
          let sum = 0
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++)
              sum +=
                (kernel[Math.abs(dy) * 3 + Math.abs(dx)] ?? 0) *
                (raw[(y + dy + 2) * 68 + x + dx + 2] ?? 0)
          data[y * 64 + x] = sum * normalization
        }
    },
    release(): void {
      memory.release(luma)
      memory.release(raw)
      memory.release(data)
    },
  }
}
