import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { createEvidenceSession, instrumentImageSource } from '../src/evidence.ts'
import { openGainMapImage } from '../src/hdr/index.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const rgba = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4)
  }
  return data
}

const encoded = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array => jpeg.encode({ width, height, data: rgba(width, height, pixel) }, 100).data

const segment = (marker: number, payload: Uint8Array): Uint8Array => {
  const length = payload.length + 2
  return Uint8Array.from([0xff, marker, length >>> 8, length & 255, ...payload])
}

const mpfSegment = (
  primaryBytes: number,
  secondaryBytes: number,
  secondaryOffset: number,
): Uint8Array => {
  const payload = new Uint8Array(86)
  const view = new DataView(payload.buffer)
  payload.set(new TextEncoder().encode('MPF\0MM'), 0)
  view.setUint16(6, 42, false)
  view.setUint32(8, 8, false)
  view.setUint16(12, 3, false)
  let entry = 14
  view.setUint16(entry, 0xb000, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 4, false)
  payload.set(new TextEncoder().encode('0100'), entry + 8)
  entry += 12
  view.setUint16(entry, 0xb001, false)
  view.setUint16(entry + 2, 4, false)
  view.setUint32(entry + 4, 1, false)
  view.setUint32(entry + 8, 2, false)
  entry += 12
  view.setUint16(entry, 0xb002, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 32, false)
  view.setUint32(entry + 8, 50, false)
  view.setUint32(54, 0x2003_0000, false)
  view.setUint32(58, primaryBytes, false)
  view.setUint32(62, 0, false)
  view.setUint32(70, 0, false)
  view.setUint32(74, secondaryBytes, false)
  view.setUint32(78, secondaryOffset, false)
  return segment(0xe2, payload)
}

const compound = (): {
  readonly input: Uint8Array
  readonly base: Uint8Array
  readonly gain: Uint8Array
} => {
  const base = encoded(8, 4, (x, y) => [96 + x * 12, 64 + y * 20, 48, 255])
  const gain = encoded(4, 2, () => [255, 255, 255, 255])
  const xml =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:g="http://ns.adobe.com/hdr-gain-map/1.0/" xmlns:c="http://ns.google.com/photos/1.0/container/" xmlns:i="http://ns.google.com/photos/1.0/container/item/" ' +
    'g:Version="1.0" g:GainMapMin="0" g:GainMapMax="2" g:Gamma="1" g:OffsetSDR="0" g:OffsetHDR="0" g:HDRCapacityMin="0" g:HDRCapacityMax="2">' +
    '<c:Directory><rdf:Seq><rdf:li><c:Item i:Semantic="Primary" i:Mime="image/jpeg"/></rdf:li>' +
    `<rdf:li><c:Item i:Semantic="GainMap" i:Mime="image/jpeg" i:Length="${gain.length}"/></rdf:li>` +
    '</rdf:Seq></c:Directory></rdf:Description></rdf:RDF></x:xmpmeta>'
  const xmp = segment(0xe1, new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0${xml}`))
  const provisional = mpfSegment(0, gain.length, 0)
  const primaryBytes = base.length + xmp.length + provisional.length
  const tiffOffset = 2 + xmp.length + 8
  const mpf = mpfSegment(primaryBytes, gain.length, primaryBytes - tiffOffset)
  const input = Uint8Array.from([
    ...base.subarray(0, 2),
    ...xmp,
    ...mpf,
    ...base.subarray(2),
    ...gain,
  ])
  return { input, base, gain }
}

const collectRgb = async (source: Uint8Array): Promise<Uint8Array> => {
  if (!jpegCodec.createDecoder) throw new Error('JPEG decoder is missing')
  const decoder = await jpegCodec.createDecoder(new MemorySource(source), defaultImageLimits)
  const output = new Uint8Array(decoder.width * decoder.height * 3)
  for await (const block of decoder.decode()) {
    for (let y = 0; y < block.height; y += 1) {
      output.set(
        block.data.subarray(y * block.stride, y * block.stride + block.width * 3),
        (block.y + y) * decoder.width * 3,
      )
    }
    block.release?.()
  }
  return output
}

const srgbToLinear = (encoded: number): number => {
  const value = encoded / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

describe('openGainMapImage', () => {
  it('extracts child codestreams exactly and renders bounded float rows at a selected boost', async () => {
    const fixture = compound()
    const image = await openGainMapImage(fixture.input)
    expect(image.inspection()).toMatchObject({
      container: 'jpeg',
      status: 'valid',
      metadata: {
        baseDimensions: { width: 8, height: 4 },
        gainMapDimensions: { width: 4, height: 2 },
        capacityMaximum: 2,
      },
    })
    const inspection = image.inspection()
    if (inspection.container !== 'jpeg') throw new Error('Expected a JPEG gain map')
    expect(await image.extractBase()).toEqual(
      fixture.input.subarray(inspection.primary.start, inspection.primary.end),
    )
    expect(await image.extractGainMap()).toEqual(new Uint8Array(fixture.gain))

    const decodedBase = await collectRgb(fixture.base)
    const oneX: number[] = []
    for await (const block of image.render({ displayBoost: 1 })) {
      expect(block.pixelFormat).toBe('rgbf32')
      expect(block.height).toBeLessThanOrEqual(32)
      oneX.push(...block.data)
    }
    expect(oneX).toHaveLength(8 * 4 * 3)
    for (let index = 0; index < oneX.length; index += 1) {
      expect(oneX[index]).toBeCloseTo(srgbToLinear(decodedBase[index] ?? 0), 6)
    }

    const full: number[] = []
    for await (const block of image.render({ displayBoost: 4 })) full.push(...block.data)
    expect(full[0]).toBeCloseTo((oneX[0] ?? 0) * 4, 2)
    expect(Math.max(...full)).toBeGreaterThan(1)

    image.close()
    image.close()
    expect(() => image.inspection()).toThrow()
  })

  it('propagates cancellation before paired decode', async () => {
    const image = await openGainMapImage(compound().input)
    const controller = new AbortController()
    controller.abort()
    const iterator = image
      .render({ displayBoost: 2, signal: controller.signal })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    image.close()
  })

  it('reports bounded relationship and execution evidence without metadata payloads', async () => {
    const session = createEvidenceSession({
      mode: 'trace',
      limits: { maxEvents: 2, maxSerializedBytes: 32_768, maxSourceRanges: 16 },
    })
    const source = instrumentImageSource(new MemorySource(compound().input), session.context)
    const image = await openGainMapImage(source, { evidence: session.context })
    await image.extractOriginalBase()
    const transformed = image
      .crop({ x: 0, y: 0, width: 6, height: 4 })
      .resize({ width: 4, height: 2, kernel: 'bilinear' })
    for await (const block of transformed.render({ displayBoost: 2 }))
      expect(block.height).toBeGreaterThan(0)
    await transformed.jpeg()
    image.close()
    const report = session.finalize()
    expect(report.scopes.map((scope) => scope.label)).toEqual(
      expect.arrayContaining([
        'compound JPEG inspection',
        'base extraction',
        'primary decode',
        'gain-map decode',
        'primary transform',
        'map source-region resampling',
        'map resize',
        'selected-boost composition',
        'primary encode',
        'map encode',
        'JPEG metadata and MPF assembly',
        'bit-preserving repack',
      ]),
    )
    expect(report.execution.decodedPixels).toBeGreaterThan(0)
    expect(report.collection.retainedEvents).toBeLessThanOrEqual(2)
    expect(report.session.droppedEvents).toBeGreaterThan(0)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('GainMapMax')
    expect(serialized).not.toContain('ns.adobe.com')
  })
})
