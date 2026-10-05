import {
  allocateJpegXlArray,
  type JpegXlEncoderMemory,
  withJpegXlMemory,
} from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'

/** Reversible forward Modular channel permutations and transforms. */
export const applyJpegXlModularRct = (
  values: readonly Int32Array[],
  beginChannel = 0,
  type = 6,
): void => {
  if (!Number.isInteger(type) || type < 0 || type >= 42)
    throw invalidJpegXlInput('forward RCT type is invalid')
  const permutation = Math.floor(type / 7)
  const first = values[beginChannel + (permutation % 3)]
  const second = values[beginChannel + ((permutation + 1 + Math.floor(permutation / 3)) % 3)]
  const third = values[beginChannel + ((permutation + 2 - Math.floor(permutation / 3)) % 3)]
  const a = values[beginChannel],
    b = values[beginChannel + 1],
    c = values[beginChannel + 2]
  if (
    !first ||
    !second ||
    !third ||
    !a ||
    !b ||
    !c ||
    a.length !== b.length ||
    a.length !== c.length
  )
    throw invalidJpegXlInput('forward RCT planes are unavailable or inconsistent')
  // Resolve the transform before traversing coefficients; read all inputs before
  // writing because channel permutations can alias any destination plane.
  switch (type % 7) {
    case 0:
      for (let i = 0; i < a.length; i++) {
        const x = first[i] ?? 0,
          y = second[i] ?? 0,
          z = third[i] ?? 0
        a[i] = x
        b[i] = y
        c[i] = z
      }
      return
    case 1:
      for (let i = 0; i < a.length; i++) {
        const x = first[i] ?? 0,
          y = second[i] ?? 0,
          z = third[i] ?? 0
        a[i] = x
        b[i] = y
        c[i] = z - x
      }
      return
    case 2:
      for (let i = 0; i < a.length; i++) {
        const x = first[i] ?? 0,
          y = second[i] ?? 0,
          z = third[i] ?? 0
        a[i] = x
        b[i] = y - x
        c[i] = z
      }
      return
    case 3:
      for (let i = 0; i < a.length; i++) {
        const x = first[i] ?? 0,
          y = second[i] ?? 0,
          z = third[i] ?? 0
        a[i] = x
        b[i] = y - x
        c[i] = z - x
      }
      return
    case 4:
      for (let i = 0; i < a.length; i++) {
        const x = first[i] ?? 0,
          y = second[i] ?? 0,
          z = third[i] ?? 0
        a[i] = x
        b[i] = y - ((x + z) >> 1)
        c[i] = z
      }
      return
    case 5:
      for (let i = 0; i < a.length; i++) {
        const x = first[i] ?? 0,
          y = second[i] ?? 0,
          z = third[i] ?? 0
        a[i] = x
        b[i] = y - ((x + z) >> 1)
        c[i] = z - x
      }
      return
    case 6:
      for (let i = 0; i < a.length; i++) {
        const x = first[i] ?? 0,
          y = second[i] ?? 0,
          z = third[i] ?? 0
        const difference = x - z,
          base = z + (difference >> 1),
          chroma = y - base
        a[i] = base + (chroma >> 1)
        b[i] = difference
        c[i] = chroma
      }
  }
}

/** Choose one extra full-input candidate from bounded literal-rate samples. */
export const chooseJpegXlModularRct = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'rgb8' | 'rgba8' | 'rgb16' | 'rgba16',
  current: number,
  memory?: JpegXlEncoderMemory,
  originX = 0,
  originY = 0,
  rowStride = width,
  maxSamples = 4096,
): number =>
  withJpegXlMemory(memory, () => {
    const sampleBytes = format.endsWith('16') ? 2 : 1,
      pixelBytes = (format.startsWith('rgba') ? 4 : 3) * sampleBytes,
      count = width * height,
      limit = Math.min(maxSamples, count)
    if (width < 2 || height < 2) return current
    const original = Array.from({ length: 12 }, () =>
      allocateJpegXlArray(memory, Int32Array, limit),
    )
    const working = original.map(() => allocateJpegXlArray(memory, Int32Array, limit))
    const neighbors = Array.from({ length: 4 }, (_, index) =>
      working.slice(index * 3, index * 3 + 3),
    )
    let samples = 0
    for (let sample = 0; sample < limit; sample++) {
      const fraction = (Math.imul(sample + 1, 0x9e37_79b1) >>> 0) / 4_294_967_296
      const position = Math.floor(((sample + fraction) * count) / limit)
      if (position < width || position % width === 0) continue
      const base =
        (originY + Math.floor(position / width)) * rowStride + originX + (position % width)
      for (let neighbor = 0; neighbor < 4; neighbor++) {
        const offset = (base - (neighbor & 1) - (neighbor >>> 1) * rowStride) * pixelBytes
        for (let channel = 0; channel < 3; channel++) {
          const plane = original[neighbor * 3 + channel]
          if (!plane) throw invalidJpegXlInput('RCT sample plane is missing')
          const at = offset + channel * sampleBytes
          plane[samples] =
            sampleBytes === 2 ? (pixels[at] ?? 0) * 256 + (pixels[at + 1] ?? 0) : (pixels[at] ?? 0)
        }
      }
      samples++
    }
    const frequencies = allocateJpegXlArray(memory, Uint32Array, 256)
    let selected = current,
      bestScore = Infinity,
      currentScore = Infinity
    for (let type = 0; type < 42; type++) {
      for (let channel = 0; channel < 12; channel++) {
        const from = original[channel],
          to = working[channel]
        if (!from || !to) throw invalidJpegXlInput('RCT work plane is missing')
        to.set(from)
      }
      for (const planes of neighbors) applyJpegXlModularRct(planes, 0, type)
      let score = 0
      for (let channel = 0; channel < 3; channel++) {
        const values = working[channel],
          left = working[channel + 3],
          top = working[channel + 6],
          topLeft = working[channel + 9]
        if (!values || !left || !top || !topLeft)
          throw invalidJpegXlInput('RCT prediction sample is missing')
        frequencies.fill(0)
        for (let sample = 0; sample < samples; sample++) {
          const w = left[sample] ?? 0,
            n = top[sample] ?? 0,
            nw = topLeft[sample] ?? 0
          const prediction = Math.max(Math.min(w, n), Math.min(Math.max(w, n), w + n - nw))
          const residual = (values[sample] ?? 0) - prediction
          const packed = residual < 0 ? -2 * residual - 1 : 2 * residual
          let token = packed
          if (packed >= 16) {
            const extra = 29 - Math.clz32(packed)
            token = 16 + (extra - 2) * 4 + (packed >>> extra) - 4
            score += extra
          }
          frequencies[token] = (frequencies[token] ?? 0) + 1
        }
        for (const frequency of frequencies)
          if (frequency > 0) score += frequency * Math.log2(samples / frequency)
      }
      if (type === current) currentScore = score
      if (score < bestScore) {
        selected = type
        bestScore = score
      }
    }
    return bestScore < currentScore * 0.99 ? selected : current
  })
