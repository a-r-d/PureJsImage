import { describe, expect, it } from 'vitest'

import { browserRuntime } from '../src/browser-runtime.ts'
import { normalizePixelColorSemantics, type PixelColorSemantics } from '../src/color.ts'
import { convertPixelBlocks } from '../src/convert.ts'
import { cropPixelBlocks } from '../src/crop.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { createOrientationTransform, type ExifOrientation } from '../src/orient.ts'
import { createRotateOperation, planMetadata } from '../src/pipeline.ts'
import {
  type PixelBlock,
  type PixelFormat,
  pixelBytesPerPixel,
  pixelStorage,
} from '../src/pixel.ts'
import { describePrecisionExecution } from '../src/precision-plan.ts'
import { createResizeTransform, decodeSrgbSample, encodeSrgbSample } from '../src/resize.ts'

const formats: readonly PixelFormat[] = [
  'gray16',
  'rgb16',
  'rgba16',
  'gray32',
  'rgb32',
  'gray64',
  'rgb64',
  'grayi8',
  'grayi16',
  'rgbi8',
  'rgbi16',
  'grayf16',
  'rgbf16',
  'grayf32',
  'rgbf32',
  'grayf64',
  'rgbf64',
  'yf32',
  'xyzf32',
]

const collect = async (blocks: AsyncIterable<PixelBlock>): Promise<PixelBlock[]> => {
  const output: PixelBlock[] = []
  for await (const block of blocks) output.push(block)
  return output
}

const concatenate = (blocks: readonly PixelBlock[]): Uint8Array => {
  const size = blocks.reduce((sum, block) => sum + block.stride * block.height, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const block of blocks) {
    output.set(block.data.subarray(0, block.stride * block.height), offset)
    offset += block.stride * block.height
  }
  return output
}

const concatenatePixels = (blocks: readonly PixelBlock[]): Uint8Array => {
  const bytesPerPixel = pixelBytesPerPixel(blocks[0]?.format ?? 'gray8')
  const size = blocks.reduce((sum, block) => sum + block.width * block.height * bytesPerPixel, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const block of blocks) {
    const rowBytes = block.width * bytesPerPixel
    for (let row = 0; row < block.height; row += 1) {
      output.set(block.data.subarray(row * block.stride, row * block.stride + rowBytes), offset)
      offset += rowBytes
    }
  }
  return output
}

const sourcePixel = (
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: ExifOrientation,
): number => {
  if (orientation === 2) return y * width + width - 1 - x
  if (orientation === 3) return (height - 1 - y) * width + width - 1 - x
  if (orientation === 4) return (height - 1 - y) * width + x
  if (orientation === 5) return x * width + y
  if (orientation === 6) return (height - 1 - x) * width + y
  if (orientation === 7) return (height - 1 - x) * width + width - 1 - y
  if (orientation === 8) return x * width + width - 1 - y
  return y * width + x
}

const semantics: PixelColorSemantics = Object.freeze({
  family: 'rgb',
  primaries: 'srgb',
  transfer: Object.freeze({ kind: 'srgb' }),
  matrix: 'identity',
  range: 'full',
  alpha: 'straight',
  provenance: 'container-signaled',
})

describe('pixel storage and color semantics', () => {
  it('normalizes every semantic enum value without conflating storage', () => {
    const families = ['gray', 'rgb', 'yuv', 'xyz', 'unspecified'] as const
    const primaries = ['srgb', 'display-p3', 'rec2020', 'source-profile', 'unspecified'] as const
    const matrices = ['identity', 'bt601', 'bt709', 'bt2020-ncl', 'unspecified'] as const
    const ranges = ['full', 'limited', 'unspecified'] as const
    const alphas = ['none', 'straight', 'premultiplied', 'unspecified'] as const
    const provenances = [
      'decoder-converted',
      'container-signaled',
      'assumed-default',
      'unspecified',
    ] as const
    for (const family of families) {
      for (const primariesValue of primaries) {
        for (const range of ranges) {
          for (const alpha of alphas) {
            for (const provenance of provenances) {
              const matrix = family === 'yuv' ? 'bt709' : matrices[0]
              expect(
                normalizePixelColorSemantics({
                  family,
                  primaries: primariesValue,
                  transfer: { kind: 'unspecified' },
                  matrix,
                  range,
                  alpha,
                  provenance,
                }),
              ).toMatchObject({
                family,
                primaries: primariesValue,
                matrix,
                range,
                alpha,
                provenance,
              })
            }
          }
        }
      }
    }
    expect(
      normalizePixelColorSemantics({
        ...semantics,
        transfer: { kind: 'gamma', exponent: 2.2 },
        provenance: 'icc',
        icc: { relevance: 'emitted-pixels', description: 'test profile' },
      }),
    ).toMatchObject({ transfer: { kind: 'gamma', exponent: 2.2 } })
  })

  it('rejects unknown, contradictory, and invalid semantic values', () => {
    expect(() => normalizePixelColorSemantics({ ...semantics, extra: true })).toThrow(
      'Unknown pixel color semantics field',
    )
    expect(() => normalizePixelColorSemantics({ ...semantics, family: 'yuv' })).toThrow(
      'YUV pixels cannot use identity',
    )
    expect(() => normalizePixelColorSemantics({ ...semantics, provenance: 'icc' })).toThrow(
      'requires ICC semantics',
    )
    expect(() =>
      normalizePixelColorSemantics({ ...semantics, transfer: { kind: 'gamma', exponent: 0 } }),
    ).toThrow('greater than zero')
  })

  it('describes every required fixed-width format as interleaved', () => {
    for (const format of formats) {
      const storage = pixelStorage(format)
      expect(storage.layout).toBe('interleaved')
      expect(pixelBytesPerPixel(format)).toBe(storage.channels * storage.bytesPerSample)
    }
    expect(() => pixelBytesPerPixel('yuv420p10')).toThrow('fixed interleaved')
  })
})

describe('byte-preserving native transforms', () => {
  it('preserves exact bytes for every required width and EXIF orientation', async () => {
    const width = 3
    const height = 2
    for (const format of formats) {
      const bytesPerPixel = pixelBytesPerPixel(format)
      const packed = Uint8Array.from(
        { length: width * height * bytesPerPixel },
        (_value, index) => (index * 29 + 7) & 0xff,
      )
      for (let orientation = 1 as ExifOrientation; orientation <= 8; orientation += 1) {
        const stride = width * bytesPerPixel + 5
        const backing = new Uint8Array(stride * height + 11).fill(0xee)
        const data = backing.subarray(7, 7 + stride * height)
        for (let row = 0; row < height; row += 1) {
          data.set(
            packed.subarray(row * width * bytesPerPixel, (row + 1) * width * bytesPerPixel),
            row * stride,
          )
        }
        let releases = 0
        const input = async function* (): AsyncGenerator<PixelBlock> {
          yield {
            x: 0,
            y: 0,
            width,
            height,
            stride,
            format,
            data,
            colorSemantics: semantics,
            release: () => {
              releases += 1
            },
          }
        }
        const transform = createOrientationTransform(
          width,
          height,
          format,
          orientation,
          browserRuntime,
        )
        const blocks = await collect(transform.apply(input()))
        const actual = concatenatePixels(blocks)
        const outputWidth = orientation >= 5 ? height : width
        const outputHeight = orientation >= 5 ? width : height
        const expected = new Uint8Array(outputWidth * outputHeight * bytesPerPixel)
        for (let y = 0; y < outputHeight; y += 1) {
          for (let x = 0; x < outputWidth; x += 1) {
            const pixel = sourcePixel(x, y, width, height, orientation)
            expected.set(
              packed.subarray(pixel * bytesPerPixel, (pixel + 1) * bytesPerPixel),
              (y * outputWidth + x) * bytesPerPixel,
            )
          }
        }
        expect(actual, `${format} orientation ${orientation}`).toEqual(expected)
        expect(blocks.every((block) => block.colorSemantics === semantics)).toBe(true)
        for (const block of blocks) block.release?.()
        expect(releases, `${format} orientation ${orientation} release`).toBe(1)
      }
    }
  })

  it('crops padded subarray input without changing high-depth sample bytes', async () => {
    const format = 'rgb64'
    const bytesPerPixel = pixelBytesPerPixel(format)
    const stride = bytesPerPixel * 5 + 9
    const backing = new Uint8Array(stride * 3 + 4).fill(0xaa)
    const data = backing.subarray(3, 3 + stride * 3)
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        data.fill(y * 5 + x, y * stride + x * bytesPerPixel, y * stride + (x + 1) * bytesPerPixel)
      }
    }
    let releases = 0
    const input = async function* (): AsyncGenerator<PixelBlock> {
      yield { x: 0, y: 0, width: 5, height: 3, stride, format, data, release: () => releases++ }
    }
    const output = await collect(
      cropPixelBlocks(input(), 5, 3, format, { x: 1, y: 1, width: 3, height: 2 }),
    )
    expect(Array.from(concatenate(output))).toEqual(
      [6, 7, 8, 11, 12, 13].flatMap((value) => Array<number>(bytesPerPixel).fill(value)),
    )
    expect(releases).toBe(1)
  })

  it('rejects malformed blocks and planar layouts', async () => {
    const malformed = async function* (): AsyncGenerator<PixelBlock> {
      yield {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        stride: 3,
        format: 'gray16',
        data: new Uint8Array(3),
      }
    }
    await expect(
      collect(cropPixelBlocks(malformed(), 2, 1, 'gray16', { x: 0, y: 0, width: 1, height: 1 })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(() => createOrientationTransform(2, 2, 'yuv420p8', 2, browserRuntime)).toThrow(
      'fixed interleaved',
    )
  })
})

const uint16Data = (values: readonly number[]): Uint8Array =>
  Uint8Array.from(values.flatMap((value) => [value >>> 8, value & 0xff]))

const float32Data = (values: readonly number[]): Uint8Array => {
  const data = new Uint8Array(values.length * 4)
  const view = new DataView(data.buffer)
  values.forEach((value, index) => {
    view.setFloat32(index * 4, value, false)
  })
  return data
}

const oneBlock = (format: PixelFormat, width: number, height: number, data: Uint8Array) =>
  async function* (): AsyncGenerator<PixelBlock> {
    yield { x: 0, y: 0, width, height, stride: data.byteLength / height, format, data }
  }

describe('native precision resize and conversion', () => {
  it.each([
    ['nearest', [0, 2000, 6000, 8000]],
    ['bilinear', [1000, 2500, 5500, 7000]],
  ] as const)('matches an independent gray16 scalar %s reference', async (kernel, expected) => {
    const input = uint16Data([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000])
    const transform = createResizeTransform(3, 3, 'gray16', {
      width: 2,
      height: 2,
      fit: 'fill',
      kernel,
    })
    const data = concatenate(await collect(transform.apply(oneBlock('gray16', 3, 3, input)())))
    const actual = Array.from({ length: 4 }, (_value, index) =>
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(index * 2, false),
    )
    expect(actual).toEqual(expected)
  })

  it.each([
    ['gray16', uint16Data([12345, 12345, 12345, 12345])],
    ['rgb16', uint16Data(Array<number>(12).fill(23456))],
    ['rgba16', uint16Data(Array<number>(16).fill(34567))],
    ['grayf32', float32Data([1.25, 1.25, 1.25, 1.25])],
    ['rgbf32', float32Data(Array<number>(12).fill(-2.5))],
  ] as const)('resizes %s without changing its storage format', async (format, data) => {
    const transform = createResizeTransform(2, 2, format, {
      width: 3,
      height: 3,
      fit: 'fill',
      kernel: 'lanczos3',
    })
    const output = await collect(transform.apply(oneBlock(format, 2, 2, data)()))
    expect(output.every((block) => block.format === format)).toBe(true)
    expect(output[0]).toMatchObject({ width: 3, height: 3 })
  })

  it('uses premultiplied alpha for RGBA16 filtering', async () => {
    const input = uint16Data([65535, 0, 0, 0, 0, 0, 65535, 65535])
    const transform = createResizeTransform(2, 1, 'rgba16', {
      width: 1,
      height: 1,
      fit: 'fill',
      kernel: 'bilinear',
    })
    expect(
      Array.from(concatenate(await collect(transform.apply(oneBlock('rgba16', 2, 1, input)())))),
    ).toEqual([0, 0, 0, 0, 255, 255, 128, 0])
  })

  it('rejects explicitly premultiplied input before resize or pixel conversion', () => {
    const premultiplied = Object.freeze({ ...semantics, alpha: 'premultiplied' as const })
    expect(() =>
      createResizeTransform(
        2,
        1,
        'rgba16',
        { width: 1, height: 1, fit: 'fill', kernel: 'bilinear' },
        premultiplied,
      ),
    ).toThrow('premultiplied alpha')
    expect(() =>
      describePrecisionExecution({
        width: 1,
        height: 1,
        pixelFormat: 'rgba16',
        colorSemantics: premultiplied,
        operations: [{ type: 'convertPixelFormat', options: { format: 'rgba8' } }],
        encoderFormat: 'png',
        encoderPixelFormats: ['rgba8'],
      }),
    ).toThrow('premultiplied alpha')
  })

  it('propagates non-finite float samples', async () => {
    const transform = createResizeTransform(2, 1, 'grayf32', {
      width: 1,
      height: 1,
      fit: 'fill',
      kernel: 'bilinear',
    })
    const output = concatenate(
      await collect(transform.apply(oneBlock('grayf32', 2, 1, float32Data([Number.NaN, 1]))())),
    )
    expect(
      new DataView(output.buffer, output.byteOffset, output.byteLength).getFloat32(0, false),
    ).toBeNaN()
  })

  it('uses exact sRGB transfer vectors and an opt-in linear-light path', async () => {
    expect(decodeSrgbSample(0.04045)).toBeCloseTo(0.00313080495, 10)
    expect(encodeSrgbSample(0.0031308)).toBeCloseTo(0.040449936, 12)
    for (const value of [0, 0.003, 0.18, 0.5, 1]) {
      expect(decodeSrgbSample(encodeSrgbSample(value))).toBeCloseTo(value, 12)
    }
    const encoded = await collect(
      createResizeTransform(
        2,
        1,
        'rgb8',
        {
          width: 1,
          height: 1,
          fit: 'fill',
          kernel: 'bilinear',
          colorSpace: 'linear-light',
        },
        semantics,
      ).apply(oneBlock('rgb8', 2, 1, Uint8Array.of(0, 0, 0, 255, 255, 255))()),
    )
    expect(Array.from(concatenate(encoded))).toEqual([188, 188, 188])
    expect(() =>
      createResizeTransform(2, 1, 'rgb8', {
        width: 1,
        height: 1,
        colorSpace: 'linear-light',
      }),
    ).toThrow('known sRGB or linear')
  })

  it('performs explicit bounded conversions with defined rounding and alpha policy', async () => {
    const down = await collect(
      convertPixelBlocks(oneBlock('gray16', 2, 1, uint16Data([0x00ff, 0x8080]))(), 'gray16', {
        format: 'gray8',
      }),
    )
    expect(Array.from(concatenate(down))).toEqual([1, 128])
    const up = await collect(
      convertPixelBlocks(oneBlock('rgb8', 1, 1, Uint8Array.of(1, 128, 255))(), 'rgb8', {
        format: 'rgba16',
        alpha: 0.5,
      }),
    )
    expect(Array.from(concatenate(up))).toEqual([1, 1, 128, 128, 255, 255, 128, 0])
    const floated = await collect(
      convertPixelBlocks(oneBlock('grayf32', 2, 1, float32Data([-1, 3]))(), 'grayf32', {
        format: 'gray16',
        range: { minimum: -1, maximum: 3 },
      }),
    )
    expect(Array.from(concatenate(floated))).toEqual([0, 0, 255, 255])
    await expect(
      collect(
        convertPixelBlocks(oneBlock('gray16', 1, 1, uint16Data([1]))(), 'gray16', {
          format: 'gray8',
          range: { minimum: 0, maximum: 1 },
        }),
      ),
    ).rejects.toThrow('only supported for float input')
    await expect(
      collect(
        convertPixelBlocks(oneBlock('grayf32', 1, 1, float32Data([0]))(), 'grayf32', {
          format: 'gray8',
          range: { minimum: 1, maximum: 0 },
        }),
      ),
    ).rejects.toThrow('increasing finite endpoints')
    await expect(
      collect(
        convertPixelBlocks(oneBlock('rgba8', 1, 1, Uint8Array.of(255, 0, 0, 128))(), 'rgba8', {
          format: 'rgb8',
        }),
      ),
    ).rejects.toThrow('Removing alpha requires')
  })

  it('honors cancellation and releases the current conversion block exactly once', async () => {
    const controller = new AbortController()
    let releases = 0
    const input = async function* (): AsyncGenerator<PixelBlock> {
      yield {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        stride: 2,
        format: 'gray16',
        data: uint16Data([1]),
        release: () => releases++,
      }
    }
    controller.abort()
    await expect(
      collect(
        convertPixelBlocks(input(), 'gray16', { format: 'gray8' }, { signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(releases).toBe(1)
  })

  it('rejects premultiplied blocks before conversion and releases them exactly once', async () => {
    let releases = 0
    let outputs = 0
    const input = async function* (): AsyncGenerator<PixelBlock> {
      yield {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        stride: 4,
        format: 'rgba8',
        data: Uint8Array.of(128, 0, 0, 128),
        colorSemantics: Object.freeze({ ...semantics, alpha: 'premultiplied' as const }),
        release: () => releases++,
      }
    }
    const converted = convertPixelBlocks(input(), 'rgba8', { format: 'rgba8' })
    const consume = async (): Promise<void> => {
      for await (const _block of converted) outputs += 1
    }

    await expect(consume()).rejects.toThrow('premultiplied alpha')
    expect(outputs).toBe(0)
    expect(releases).toBe(1)
  })
})

describe('precision-aware planning', () => {
  it('attributes caller and encoder conversions and rejects unsupported transforms', () => {
    const caller = describePrecisionExecution({
      width: 8,
      height: 6,
      pixelFormat: 'gray16',
      operations: [{ type: 'convertPixelFormat', options: { format: 'gray8' } }],
      encoderFormat: 'png',
      encoderPixelFormats: ['gray8', 'gray16'],
    })
    expect(caller.stages.at(-1)).toMatchObject({
      reason: 'caller-conversion',
      precisionLoss: true,
      outputFormat: 'gray8',
    })
    const terminal = describePrecisionExecution({
      width: 8,
      height: 6,
      pixelFormat: 'gray16',
      operations: [],
      encoderFormat: 'jpeg',
      encoderPixelFormats: ['gray8', 'rgb8'],
    })
    expect(terminal.stages.at(-1)).toMatchObject({
      reason: 'encoder-required',
      precisionLoss: true,
      outputFormat: 'gray8',
    })
    expect(() =>
      describePrecisionExecution({
        width: 8,
        height: 6,
        pixelFormat: 'gray16',
        operations: [createRotateOperation(12)],
        encoderFormat: 'png',
        encoderPixelFormats: ['gray16'],
      }),
    ).toThrow('rotate does not support gray16')
  })

  it('reports PNG storage depth honestly for 10-bit and 12-bit source metadata', () => {
    for (const bitDepth of [10, 12]) {
      expect(
        planMetadata(
          {
            width: 2,
            height: 2,
            format: 'source',
            mimeType: 'image/example',
            hasAlpha: false,
            bitDepth,
          },
          [{ type: 'encode', format: 'png', options: {} }],
          defaultImageLimits,
        ).bitDepth,
      ).toBe(16)
    }
  })
})
