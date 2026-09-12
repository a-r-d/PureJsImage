import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { encodeJpegXlNative, openJpegXlSequence } from '../src/jpegxl.ts'

const collect = async <T>(values: AsyncIterable<T>): Promise<T[]> => {
  const result: T[] = []
  for await (const value of values) result.push(value)
  return result
}

describe('JPEG XL native planar preservation', () => {
  it.each([
    ['grouped-alpha-depth', 512, 512, 2],
    ['dc-alpha-shift8', 64, 512, 1],
  ] as const)(
    'extracts independently encoded %s samples exactly',
    async (name, width, height, extras) => {
      const input = await readFile(
        new URL(`./fixtures/jpegxl/m8-native/${name}.jxl`, import.meta.url),
      )
      const sequence = await openJpegXlSequence(input)
      try {
        const layers = await collect(sequence.layers())
        const layer = layers[0]
        expect(layer?.domain).toBe('xyb')
        expect(layer?.planes).toHaveLength(3 + extras)
        for (let channel = 3; channel < 3 + extras; channel++) {
          const samples = layer?.planes[channel]
          expect(samples?.length).toBe(width * height)
          let differences = 0
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const expected =
                name === 'grouped-alpha-depth'
                  ? ((y * width + x) * 7 + y * 3) & 255
                  : (x + y * 3) & 255
              if (samples?.[y * width + x] !== expected) differences++
            }
          expect(differences).toBe(0)
        }
        expect(layer?.layouts[3]).toMatchObject({ width, height })
      } finally {
        await sequence.close()
      }
    },
  )

  it('preserves grayscale ICC samples with a separate high-depth alpha plane', async () => {
    const profile = await readFile(new URL('./fixtures/jpegxl/m8-native/gray.icc', import.meta.url))
    const plane = { data: Uint16Array.of(0, 65535, 12345, 23456), bitDepth: 16 }
    const encoded = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [plane],
      iccProfile: profile,
      extraChannels: [{ ...plane, type: 0, name: 'coverage' }],
    })
    const sequence = await openJpegXlSequence(encoded)
    try {
      const layers = await collect(sequence.layers())
      expect(layers[0]?.header.colorChannels).toBe(1)
      expect(layers[0]?.header.iccProfile).toEqual(new Uint8Array(profile))
      expect(Array.from(layers[0]?.planes[0] ?? [])).toEqual(Array.from(plane.data))
      expect(Array.from(layers[0]?.planes[1] ?? [])).toEqual(Array.from(plane.data))
    } finally {
      await sequence.close()
    }
  })

  it('preserves CFA, thermal and optional channel descriptors', async () => {
    const plane = { data: Uint8Array.of(1, 2), bitDepth: 8 }
    const encoded = await encodeJpegXlNative({
      width: 2,
      height: 1,
      color: [plane],
      extraChannels: [
        { ...plane, type: 5, name: 'CFA', cfaChannel: 2 },
        { ...plane, type: 6, name: 'thermal' },
        { ...plane, type: 16, name: 'optional' },
      ],
    })
    const sequence = await openJpegXlSequence(encoded)
    try {
      const layers = await collect(sequence.layers())
      expect(layers[0]?.header.extraChannels.map((channel) => channel.type)).toEqual([5, 6, 16])
      expect(layers[0]?.header.extraChannels[0]?.cfaChannel).toBe(2)
    } finally {
      await sequence.close()
    }
  })
  it('preserves named, shifted and associated extra channels separately', async () => {
    const gray = { data: Uint16Array.of(0, 1, 32768, 65535), bitDepth: 16 }
    const bytes = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [gray],
      extraChannels: [
        { ...gray, type: 0, name: 'coverage', associatedAlpha: true },
        { type: 1, name: 'depth µm', dimShift: 1, bitDepth: 12, data: Uint16Array.of(4095, 2) },
        {
          type: 2,
          name: 'spot',
          bitDepth: 8,
          data: Uint8Array.of(0, 1, 2, 255),
          spotColor: [1, 0, 0, 0.5],
        },
        { type: 3, name: 'selection', bitDepth: 1, data: Uint8Array.of(0, 1, 1, 0) },
      ],
    })
    const sequence = await openJpegXlSequence(bytes)
    try {
      const layers = await collect(sequence.layers())
      expect(layers).toHaveLength(1)
      const layer = layers[0]
      expect(layer?.header.extraChannels.map((channel) => channel.type)).toEqual([0, 1, 2, 3])
      expect(layer?.header.extraChannels[0]?.associatedAlpha).toBe(true)
      expect(layer?.header.extraChannels[1]).toMatchObject({
        name: 'depth µm',
        dimShift: 1,
        bitDepth: { bits: 12 },
      })
      expect(layer?.header.extraChannels[2]?.spotColor).toEqual([1, 0, 0, 0.5])
      expect(Array.from(layer?.planes[0] ?? [])).toEqual(Array.from(gray.data))
      expect(Array.from(layer?.planes[2] ?? [])).toEqual([4095, 2])
      expect(layer?.layouts[2]).toMatchObject({ width: 2, height: 1 })
      if (layer?.planes[0]) layer.planes[0][0] = 999
      const replay = await collect(sequence.layers())
      expect(replay[0]?.planes[0]?.[0]).toBe(0)
    } finally {
      await sequence.close()
    }
  })

  it('preserves binary16 bit patterns including negative and HDR samples', async () => {
    const samples = Uint16Array.of(0xbc00, 0, 0x3800, 0x4000, 0x8000, 1, 0x7bff)
    const bytes = await encodeJpegXlNative({
      width: samples.length,
      height: 1,
      color: [{ data: samples, bitDepth: 16, sampleFormat: 'binary16' }],
    })
    const sequence = await openJpegXlSequence(bytes)
    try {
      const layers = await collect(sequence.layers())
      expect(layers[0]?.header).toMatchObject({
        bitDepth: 16,
        exponentBits: 5,
        sampleFormat: 'floating-point',
      })
      expect(Array.from(layers[0]?.planes[0] ?? [])).toEqual(Array.from(samples))
    } finally {
      await sequence.close()
    }
  })

  it('preserves bounded ICC bytes and integer samples', async () => {
    const icc = await readFile(
      new URL('./fixtures/jpegxl/m4-color/oriented-icc.icc', import.meta.url),
    )
    const plane = { data: Uint16Array.of(0, 100, 32768, 65535), bitDepth: 16 }
    const bytes = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [plane, plane, plane],
      iccProfile: icc,
    })
    const sequence = await openJpegXlSequence(bytes)
    try {
      const layers = await collect(sequence.layers())
      expect(layers[0]?.header.iccProfile).toEqual(new Uint8Array(icc))
      expect(Array.from(layers[0]?.planes[1] ?? [])).toEqual(Array.from(plane.data))
    } finally {
      await sequence.close()
    }
    await expect(
      encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [plane, plane, plane],
        iccProfile: icc,
        limits: { maxIccBytes: 128 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      encodeJpegXlNative({ width: 4, height: 1, color: [plane], iccProfile: icc }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects invalid samples, bounded output, bounded working memory and cancellation', async () => {
    const plane = { data: Uint16Array.of(256), bitDepth: 8 }
    await expect(encodeJpegXlNative({ width: 1, height: 1, color: [plane] })).rejects.toMatchObject(
      { code: 'INVALID_INPUT' },
    )
    const valid = { width: 1, height: 1, color: [{ data: Uint8Array.of(1), bitDepth: 8 }] as const }
    await expect(encodeJpegXlNative({ ...valid, maxOutputBytes: 4 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      encodeJpegXlNative({ ...valid, limits: { maxDecodedBytes: 64 } }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      encodeJpegXlNative({ ...valid, signal: AbortSignal.abort() }),
    ).rejects.toBeDefined()
  })
})

it('preserves explicitly signaled BT.709 transfer through native encoding', async () => {
  const sequence = await openJpegXlSequence(
    await encodeJpegXlNative({
      width: 2,
      height: 1,
      color: [{ data: Uint8Array.of(32, 224), bitDepth: 8 }],
      colorSemantics: {
        family: 'gray',
        primaries: 'srgb',
        transfer: { kind: 'bt709' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      },
    }),
  )
  try {
    for await (const header of sequence.headers())
      expect(header.colorSemanticsTransfer).toEqual({ kind: 'bt709' })
  } finally {
    await sequence.close()
  }
})

it('observes cancellation during native plane decoding before emitting a layer', async () => {
  const bytes = await readFile(
    new URL('./fixtures/jpegxl/m8-native/dc-alpha-shift8.jxl', import.meta.url),
  )
  const sequence = await openJpegXlSequence(bytes)
  const controller = new AbortController()
  const reason = new Error('Stop this extraction')
  const timer = setTimeout(() => controller.abort(reason), 0)
  try {
    const iterator = sequence.layers(controller.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toBe(reason)
  } finally {
    clearTimeout(timer)
    await sequence.close()
  }
})

it('observes cancellation during native encoding', async () => {
  const controller = new AbortController()
  const reason = new Error('Stop this encoding')
  const timer = setTimeout(() => controller.abort(reason), 0)
  try {
    await expect(
      encodeJpegXlNative({
        width: 1024,
        height: 1024,
        color: [{ data: new Uint16Array(1024 * 1024).fill(16384), bitDepth: 16 }],
        signal: controller.signal,
      }),
    ).rejects.toBe(reason)
  } finally {
    clearTimeout(timer)
  }
})

it('rejects an independently rejected combined extra-channel shift above eight', async () => {
  const bytes = await readFile(
    new URL('./fixtures/jpegxl/m8-native/invalid-combined-shift16.jxl', import.meta.url),
  )
  const sequence = await openJpegXlSequence(bytes)
  try {
    await expect(collect(sequence.headers())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  } finally {
    await sequence.close()
  }
})

it('keeps raw shifted samples separate from reconstructed alpha', async () => {
  const bytes = await readFile(
    new URL('./fixtures/jpegxl/m8-native/modular-upsampling.jxl', import.meta.url),
  )
  const sequence = await openJpegXlSequence(bytes)
  try {
    const native = await collect(sequence.layers())
    expect(native[0]?.layouts[3]).toMatchObject({ width: 8, height: 8 })
    expect(Array.from(native[0]?.planes[3] ?? [])).toEqual(
      Array.from({ length: 64 }, (_, i) => i * 4),
    )
    const frame = await sequence.frame(0)
    expect(frame.planes[3]?.length).toBe(64 * 64)
  } finally {
    await sequence.close()
  }
})

it('keeps raw reference storage independent of caller-owned layer planes', async () => {
  const bytes = await readFile(
    new URL('./fixtures/jpegxl/m8-static/weighted-patches-lossy.jxl', import.meta.url),
  )
  const sequence = await openJpegXlSequence(bytes)
  try {
    const expected = await collect(sequence.layers())
    const iterator = sequence.layers()[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done) throw new Error('Missing reference layer')
    for (const plane of first.value.planes) plane.fill(0)
    const second = await iterator.next()
    if (second.done) throw new Error('Missing dependent layer')
    expect(second.value.planes).toEqual(expected[1]?.planes)
    await iterator.return?.()
  } finally {
    await sequence.close()
  }
})

it('observes cancellation while decoding a large Modular layer', async () => {
  const input = await encodeJpegXlNative({
    width: 1024,
    height: 1024,
    color: [{ data: new Uint8Array(1024 * 1024).fill(123), bitDepth: 8 }],
  })
  const sequence = await openJpegXlSequence(input)
  const controller = new AbortController(),
    reason = new Error('Stop Modular extraction')
  const timer = setTimeout(() => controller.abort(reason), 0)
  try {
    await expect(sequence.layers(controller.signal)[Symbol.asyncIterator]().next()).rejects.toBe(
      reason,
    )
  } finally {
    clearTimeout(timer)
    await sequence.close()
  }
})
