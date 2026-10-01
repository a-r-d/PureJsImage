import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createImageLibrary } from '../src/browser.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { encodeJpegXlNative, inspectJpegXl, openJpegXlSequence } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import composed from './fixtures/jpegxl/composed-native/manifest.json' with { type: 'json' }
import manifest from './fixtures/jpegxl/float-completion/manifest.json' with { type: 'json' }
import { verifyJpegXlFloatCompletion } from './helpers/jpegxl-float-completion.ts'
import { collectJpegXlProfileRows } from './helpers/jpegxl-profile-pipeline.ts'

const Image = createImageLibrary({ codecs: [jpegxlCodec] })
const encode = jpegxlCodec.createEncoder
const decode = jpegxlCodec.createDecoder
if (!encode || !decode) throw new Error('Missing JPEG XL codec')
const read = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(new URL(`./fixtures/jpegxl/${file}`, import.meta.url)))
describe('JPEG XL floating pipeline completion', () => {
  for (const [directory, fixtures] of [
    ['float-completion', manifest.fixtures],
    ['composed-native', composed.fixtures],
  ] as const)
    for (const fixture of fixtures)
      it(`matches independent ${fixture.id} reference through public pipelines`, async () => {
        const input = await read(`${directory}/${fixture.file}`)
        const reference = gunzipSync(await read(`${directory}/${fixture.id}.bin.gz`))
        const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
        expect(hash(input)).toBe(fixture.sha256)
        expect(hash(reference)).toBe(fixture.referenceSha256)
        const linear =
          fixture.category === 'hdr'
            ? gunzipSync(await read(`${directory}/${fixture.id}.linear.bin.gz`))
            : undefined
        const result = await verifyJpegXlFloatCompletion(input, reference, fixture, linear)
        expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
      }, 30_000)
  it.each(['gray16-linear', 'rgb32-linear', 'p3-32-alpha32-associated'])(
    'losslessly re-encodes %s float rows with source semantics',
    async (id) => {
      const bytes = await read(`float-color/${id}.jxl`)
      const encoded = await (await Image.open(bytes)).jpegxl().toUint8Array()
      const before = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      const after = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
      if (!before || !after) throw new Error('Missing float roundtrip decoder')
      expect(after.pixelFormat).toBe(before.pixelFormat)
      expect(await collectJpegXlProfileRows(after)).toEqual(await collectJpegXlProfileRows(before))
      expect(after.colorSemantics?.transfer).toEqual(before.colorSemantics?.transfer)
      expect(after.colorSemantics?.primaries).toBe(before.colorSemantics?.primaries)
      const metadata = await inspectJpegXl(encoded)
      expect(metadata.bitDepth).toBe(32)
      expect(metadata.exponentBits).toBe(8)
      expect(metadata.level).toBe(10)
    },
  )
  it('preserves finite float bit patterns, luminance metadata, intrinsic size and orientation', async () => {
    const bytes = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [
        {
          data: Uint32Array.of(0x80000000, 0xbf800000, 1, 0x40000000),
          bitDepth: 32,
          sampleFormat: 'binary32',
        },
      ],
      orientation: 6,
      intrinsicSize: { width: 8, height: 2 },
      toneMapping: {
        intensityTarget: 1000,
        minNits: 0.5,
        relativeToMaxDisplay: false,
        linearBelow: 0,
      },
    })
    const decoded = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
    if (!decoded?.colorSemantics) throw new Error('Missing float decoder')
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 4,
      height: 1,
      pixelFormat: 'grayf32',
      colorSemantics: decoded.colorSemantics,
      options: decoded.execution?.encodingDefaults?.options ?? {},
    })
    if (!encoder) throw new Error('Missing float encoder')
    for await (const block of decoded.decode()) await encoder.write(block)
    await encoder.finish()
    const encoded = sink.toUint8Array()
    const reopened = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      defaultImageLimits,
    )
    if (!reopened) throw new Error('Missing encoded float decoder')
    expect(await collectJpegXlProfileRows(reopened)).toEqual(
      await collectJpegXlProfileRows(decoded),
    )
    const metadata = await inspectJpegXl(encoded)
    expect(metadata.orientation).toBe(6)
    expect(metadata.intrinsicWidth).toBe(8)
    expect(metadata.intrinsicHeight).toBe(2)
    expect(metadata.toneMapping.intensityTarget).toBe(1000)
  })
  it('encodes lossy float output and rejects insufficient working storage before consuming rows', async () => {
    const image = await Image.open(await read('float-color/rgb32-linear.jxl'))
    const lossy = await image.jpegxl({ mode: 'lossy' }).toUint8Array()
    const reopened = await jpegxlCodec.createDecoder?.(new MemorySource(lossy), defaultImageLimits)
    expect(reopened?.pixelFormat).toBe('rgbf32')
    await expect(image.jpegxl({ maxWorkingBytes: 65536 }).toUint8Array()).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })
  it('rejects nonfinite colors produced by an invalid floating gray ICC curve', async () => {
    const profile = await read('m8-native/gray.icc')
    const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
    let curveOffset = 0
    for (let index = 0; index < view.getUint32(128, false); index++) {
      const tag = 132 + index * 12
      if (view.getUint32(tag, false) === 0x6b545243) curveOffset = view.getUint32(tag + 4, false)
    }
    if (!curveOffset) throw new Error('Missing gray ICC tone curve')
    view.setUint32(curveOffset, 0x70617261, false)
    view.setUint16(curveOffset + 8, 0, false)
    view.setInt32(curveOffset + 12, -2147483648, false)
    const input = await encodeJpegXlNative({
      width: 1,
      height: 1,
      color: [{ data: Uint32Array.of(0x3f000000), bitDepth: 32, sampleFormat: 'binary32' }],
      iccProfile: profile,
    })
    await expect(
      Image.open(input, { colorOutput: 'srgb' }).then((image) => image.jpegxl().toUint8Array()),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it.each([0x7fc00000, 0x7f800000, 0xff800000])(
    'rejects nonfinite encoder input %s and aborts its sink',
    async (bits) => {
      const sink = new Uint8ArraySink(),
        data = new Uint8Array(4)
      new DataView(data.buffer).setUint32(0, bits, false)
      const encoder = await jpegxlCodec.createEncoder?.(sink, {
        width: 1,
        height: 1,
        pixelFormat: 'grayf32',
        options: {},
        colorSemantics: {
          family: 'gray',
          primaries: 'srgb',
          transfer: { kind: 'linear' },
          matrix: 'identity',
          range: 'full',
          alpha: 'none',
          provenance: 'container-signaled',
        },
      })
      if (!encoder) throw new Error('Missing float encoder')
      await expect(
        encoder.write({ x: 0, y: 0, width: 1, height: 1, stride: 4, format: 'grayf32', data }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      await expect(encoder.finish()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      expect(sink.toUint8Array().length).toBe(0)
    },
  )
  it('bounds composed storage and cumulative replay, requires animation selection and supports cancellation', async () => {
    const bytes = await read('composed-native/float32-straight-blend-animation.jxl')
    await expect(
      Image.open(bytes).then((image) => image.jpegxl().toUint8Array()),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    await expect(
      jpegxlCodec.createDecoder?.(
        new MemorySource(bytes),
        { ...defaultImageLimits, maxDecodedBytes: 128 },
        { frame: 2 },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const sequence = await openJpegXlSequence(bytes, { maxDecodedPixels: 18 })
    try {
      await expect(sequence.frame(2)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    } finally {
      await sequence.close()
    }
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
      frame: 2,
    })
    if (!decoder) throw new Error('Missing composed float decoder')
    const controller = new AbortController(),
      iterator = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect((await collectJpegXlProfileRows(decoder)).length).toBe(288)
    await expect(
      collectJpegXlProfileRows(
        await decode(new MemorySource(bytes), defaultImageLimits, { frame: 99 }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it('requires a preserved profile for source-profile encoding and rejects lossy depth changes', async () => {
    const image = await Image.open(await read('float-completion/rgb32-icc.jxl'), {
      colorOutput: 'preserve',
    })
    await expect(image.jpegxl().toUint8Array()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    const structured = await Image.open(await read('float-color/rgb32-linear.jxl'))
    await expect(structured.jpegxl({ sampleBitDepth: 16 }).toUint8Array()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    await expect(structured.jpegxl({ container: false }).toUint8Array()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(structured.jpegxl({ maxOutputBytes: 50 }).toUint8Array()).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })
  it('aborts incomplete, unordered, cancelled and failed-sink encoders', async () => {
    const source = await jpegxlCodec.createDecoder?.(
      new MemorySource(await read('float-color/rgb32-linear.jxl')),
      defaultImageLimits,
    )
    if (!source?.colorSemantics) throw new Error('Missing source semantics')
    const request = {
      width: source.width,
      height: source.height,
      pixelFormat: source.pixelFormat,
      colorSemantics: source.colorSemantics,
      options: {},
    }
    const incomplete = await encode(new Uint8ArraySink(), request)
    await expect(incomplete.finish()).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
    const unordered = await encode(new Uint8ArraySink(), request)
    for await (const block of source.decode()) {
      await expect(unordered.write({ ...block, y: 1 })).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
      break
    }
    const controller = new AbortController(),
      cancelled = await encode(new Uint8ArraySink(), {
        ...request,
        signal: controller.signal,
      })
    controller.abort()
    await expect(
      encode(new Uint8ArraySink(), { ...request, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    for await (const block of source.decode()) {
      await expect(cancelled.write(block)).rejects.toMatchObject({ name: 'AbortError' })
      break
    }
    const failure = new Error('sink failed'),
      aborted: unknown[] = []
    const encoder = await encode(
      {
        async write() {
          throw failure
        },
        async close() {},
        async abort(reason) {
          aborted.push(reason)
        },
      },
      request,
    )
    for await (const block of source.decode()) await encoder.write(block)
    await expect(encoder.finish()).rejects.toBe(failure)
    expect(aborted).toEqual([failure])
  })
})
