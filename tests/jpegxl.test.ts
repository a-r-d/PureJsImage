import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspectJpegXlStructure, jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const box = (type: string, payload: Uint8Array, extended = false): Uint8Array => {
  const headerBytes = extended ? 16 : 8
  const output = new Uint8Array(headerBytes + payload.byteLength)
  const view = new DataView(output.buffer)
  view.setUint32(0, extended ? 1 : output.byteLength)
  output.set(ascii(type), 4)
  if (extended) view.setBigUint64(8, BigInt(output.byteLength))
  output.set(payload, headerBytes)
  return output
}

const signature = box('JXL ', Uint8Array.of(0x0d, 0x0a, 0x87, 0x0a))
const fileType = (brand = 'jxl '): Uint8Array =>
  box('ftyp', concatenate(ascii(brand), Uint8Array.of(0, 0, 0, 0), ascii('jxl ')))

const fragment = (index: number, final: boolean, payload: Uint8Array): Uint8Array => {
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, index | (final ? 0x8000_0000 : 0))
  return box('jxlp', concatenate(header, payload))
}

describe('JPEG XL probing and lossless Modular decoding', () => {
  it('exposes a registered decoder for raw codestreams and containers', () => {
    expect(jpegxlCodec.format).toBe('jpegxl')
    expect(jpegxlCodec.mimeTypes).toEqual(['image/jxl'])
    expect(jpegxlCodec.createDecoder).toBeTypeOf('function')
    expect(jpegxlCodec.createEncoder).toBeUndefined()
    expect(jpegxlCodec.detect(Uint8Array.of(0xff, 0x0a))).toBe(true)
    expect(jpegxlCodec.detect(signature)).toBe(true)
    expect(jpegxlCodec.detect(Uint8Array.of(0xff, 0x0b))).toBe(false)
  })

  it('decodes the pinned 12-bit lossless RGBA conformance image exactly', async () => {
    const input = readFileSync('benchmark/fixtures/jpegxl/conformance-alpha-nonpremultiplied.jxl')
    const source = new MemorySource(input)
    const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')

    expect(metadata).toMatchObject({
      width: 1_024,
      height: 1_024,
      bitDepth: 12,
      hasAlpha: true,
      lossless: true,
      channelBitDepths: [12, 12, 12, 12],
    })
    expect(decoder.pixelFormat).toBe('rgba8')
    expect(decoder.capabilities).toEqual({
      sequential: true,
      regionDecode: true,
      scaledDecode: false,
      progressive: false,
    })

    const digest = createHash('sha256')
    let rows = 0
    for await (const block of decoder.decode()) {
      expect(block).toMatchObject({ x: 0, y: rows, width: 1_024, height: 1, format: 'rgba8' })
      digest.update(block.data)
      rows += 1
    }
    expect(rows).toBe(1_024)
    // djxl-produced 12-bit PAM samples, normalized with round(sample * 255 / 4095).
    expect(digest.digest('hex')).toBe(
      'c2d13d30f972b292ea49889bd8bc1315bad8486da6a984b2dea4fe057102a2d4',
    )
  })

  it('decodes the implemented subset directly from a jxlc container', async () => {
    const codestream = readFileSync(
      'benchmark/fixtures/jpegxl/conformance-alpha-nonpremultiplied.jxl',
    )
    const input = concatenate(signature, fileType(), box('jxlc', codestream))
    const metadata = await jpegxlCodec.metadata(new MemorySource(input), defaultImageLimits)

    expect(metadata).toMatchObject({ width: 1_024, height: 1_024, bitDepth: 12 })
  })

  it('identifies a raw codestream without parsing image metadata', async () => {
    const structure = await inspectJpegXlStructure(Uint8Array.of(0xff, 0x0a, 1, 2, 3))
    expect(structure).toEqual({
      kind: 'raw-codestream',
      codestreamBytes: 5,
      codestreamSegments: [{ offset: 0, length: 5, index: 0 }],
      boxes: [],
      metadataBoxes: [],
    })
  })

  it('validates a jxlc container and indexes metadata without reading its payload', async () => {
    const input = concatenate(
      signature,
      fileType(),
      box('Exif', Uint8Array.of(1, 2, 3), true),
      box('jxlc', Uint8Array.of(0xff, 0x0a, 4, 5)),
    )
    const structure = await inspectJpegXlStructure(input)
    expect(structure.kind).toBe('container')
    expect(structure.codestreamBytes).toBe(4)
    expect(structure.codestreamSegments).toHaveLength(1)
    expect(structure.metadataBoxes).toEqual([expect.objectContaining({ type: 'Exif', length: 19 })])
  })

  it('indexes ordered jxlp fragments without concatenating them', async () => {
    const input = concatenate(
      signature,
      fileType(),
      fragment(0, false, Uint8Array.of(0xff, 0x0a, 1)),
      fragment(1, true, Uint8Array.of(2, 3, 4)),
    )
    const structure = await inspectJpegXlStructure(input)
    expect(structure.codestreamBytes).toBe(6)
    expect(structure.codestreamSegments.map(({ index, length }) => ({ index, length }))).toEqual([
      { index: 0, length: 3 },
      { index: 1, length: 3 },
    ])
  })

  it('rejects lookalikes, invalid brands, malformed extents, and missing codestreams', async () => {
    const lookalike = signature.slice()
    lookalike[8] = 0
    await expect(inspectJpegXlStructure(lookalike)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(
      inspectJpegXlStructure(
        concatenate(
          signature,
          box('ftyp', concatenate(ascii('fake'), Uint8Array.of(0, 0, 0, 0))),
          box('jxlc', Uint8Array.of(0xff, 0x0a)),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const badExtent = concatenate(signature, fileType(), box('jxlc', Uint8Array.of(0xff, 0x0a)))
    new DataView(badExtent.buffer).setUint32(signature.byteLength + fileType().byteLength, 1_000)
    await expect(inspectJpegXlStructure(badExtent)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(inspectJpegXlStructure(concatenate(signature, fileType()))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects conflicting and malformed codestream representations', async () => {
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), fileType(), box('jxlc', Uint8Array.of(0xff, 0x0a))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(
          signature,
          fileType(),
          box('jxlc', Uint8Array.of(0xff, 0x0a)),
          fragment(0, true, Uint8Array.of(0xff, 0x0a)),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), fragment(1, true, Uint8Array.of(0xff, 0x0a))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), fragment(0, false, Uint8Array.of(0xff, 0x0a))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), box('jxlc', Uint8Array.of(0, 0, 0))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
