import { expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

it('preserves periodic four-color artwork and true alpha above one megapixel', async () => {
  const width = 1025,
    height = 1025,
    budget = 134_217_728
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const slot = (y >>> 7) & 3,
        at = (y * width + x) * 4
      pixels[at] = 24 + slot * 43
      pixels[at + 1] = 216 - slot * 37
      pixels[at + 2] = 47 + slot * 51
      pixels[at + 3] = (slot & 1) === 0 ? 128 : 255
    }
  const before = pixels.slice(),
    sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgba8',
    limits: defaultImageLimits,
    options: { mode: 'lossy', effort: 7, distance: 3, maxWorkingBytes: budget },
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
  })
  if (!encoder) throw new Error('Missing artwork encoder')
  if (!('managedPeakBytes' in encoder) || typeof encoder.managedPeakBytes !== 'number')
    throw new Error('Missing artwork storage accounting')
  try {
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 4,
      format: 'rgba8',
      data: pixels,
    })
    await encoder.finish()
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(sink.toUint8Array()),
      defaultImageLimits,
    )
    if (
      !decoder ||
      decoder.pixelFormat !== 'rgba8' ||
      decoder.width !== width ||
      decoder.height !== height
    )
      throw new Error('True-alpha artwork layout changed')
    const visited = new Uint8Array(width * height)
    let samples = 0,
      visibleError = 0,
      alphaError = 0
    for await (const block of decoder.decode())
      try {
        if (
          block.format !== 'rgba8' ||
          block.x < 0 ||
          block.y < 0 ||
          block.x + block.width > width ||
          block.y + block.height > height ||
          block.stride < block.width * 4 ||
          block.data.length < (block.height - 1) * block.stride + block.width * 4
        )
          throw new Error('Invalid true-alpha artwork block')
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++) {
            const p = (block.y + y) * width + block.x + x,
              at = y * block.stride + x * 4
            if (visited[p] !== 0) throw new Error('Repeated true-alpha pixel')
            visited[p] = 1
            samples++
            for (let c = 0; c < 3; c++) {
              const actual = block.data[at + c],
                original = pixels[p * 4 + c]
              if (actual === undefined || original === undefined)
                throw new Error('Missing visible artwork sample')
              visibleError = Math.max(visibleError, Math.abs(actual - original))
            }
            const alpha = block.data[at + 3],
              originalAlpha = pixels[p * 4 + 3]
            if (alpha === undefined || originalAlpha === undefined)
              throw new Error('Missing artwork alpha')
            alphaError = Math.max(alphaError, Math.abs(alpha - originalAlpha))
          }
      } finally {
        block.release?.()
      }
    expect(samples).toBe(width * height)
    expect(visibleError).toBe(0)
    expect(alphaError).toBe(0)
  } finally {
    let changed = 0
    for (let i = 0; i < pixels.length; i++) if (pixels[i] !== before[i]) changed++
    expect(changed).toBe(0)
    expect(encoder.managedPeakBytes).toBeLessThanOrEqual(budget)
    expect('managedLiveBytes' in encoder && encoder.managedLiveBytes).toBe(0)
    expect('managedLiveAllocations' in encoder && encoder.managedLiveAllocations).toBe(0)
  }
}, 120_000)
