import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { encodeJpegXlNative, inspectJpegXl } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import frames from './fixtures/jpegxl/m8-sequence/newtons-cradle.frames.json' with { type: 'json' }

describe('JPEG XL inspection support reporting', () => {
  it('reports supported Level 10 integer decoding without a spurious unsupported feature', async () => {
    const encoded = await encodeJpegXlNative({
      width: 3,
      height: 1,
      color: [{ data: Uint32Array.of(0, 32768, 65535), bitDepth: 16 }],
      codestreamLevel: 10,
    })
    const inspection = await inspectJpegXl(encoded)
    expect(inspection).toMatchObject({ level: 10, imageKind: 'static', frameCount: 1 })
    expect(inspection.unsupportedFeatures).toEqual(['exact JPEG reconstruction'])
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoder) throw new Error('Missing decoder')
    const output = await decoder.decode()[Symbol.asyncIterator]().next()
    if (output.done) throw new Error('Missing row')
    expect(output.value.data).toEqual(Uint8Array.of(0, 0, 128, 0, 255, 255))
    output.value.release?.()
  })
  it('reports actual animation frame count and supports explicit displayed-frame selection', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('./fixtures/jpegxl/m8-sequence/newtons-cradle.jxl', import.meta.url)),
    )
    const inspection = await inspectJpegXl(bytes)
    expect(inspection).toMatchObject({ imageKind: 'animation', frameCount: frames.length })
    expect(inspection.unsupportedFeatures).not.toContain('animation')
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
      frame: 0,
    })
    if (!decoder) throw new Error('Missing decoder')
    const iterator = decoder.decode()[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    await iterator.return?.(undefined)
  })
  it.each([
    {
      bitDepth: 31,
      sampleFormat: 'unsigned-integer' as const,
      expected: 'integer pixels above 16 bits require native channel extraction',
    },
    {
      bitDepth: 32,
      sampleFormat: 'binary32' as const,
      expected: 'floating-point pixels require native channel extraction',
    },
  ])(
    'identifies the native extraction boundary for $sampleFormat',
    async ({ bitDepth, sampleFormat, expected }) => {
      const bytes = await encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [{ data: Uint32Array.of(1), bitDepth, sampleFormat }],
      })
      expect((await inspectJpegXl(bytes)).unsupportedFeatures).toContain(expected)
    },
  )
})
