import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { findJpegEnd, inspectHdrJpeg } from '../src/hdr/index.ts'
import { MemorySource } from '../src/source.ts'

const segment = (marker: number, payload: Uint8Array): Uint8Array => {
  const length = payload.length + 2
  return Uint8Array.from([0xff, marker, length >>> 8, length & 255, ...payload])
}

const minimalJpeg = (
  width: number,
  height: number,
  progressive = false,
  components = 1,
): Uint8Array => {
  const componentBytes = Array.from({ length: components }, (_, index) => [
    index + 1,
    0x11,
    0,
  ]).flat()
  return Uint8Array.from([
    0xff,
    0xd8,
    ...segment(
      progressive ? 0xc2 : 0xc0,
      Uint8Array.from([
        8,
        height >>> 8,
        height & 255,
        width >>> 8,
        width & 255,
        components,
        ...componentBytes,
      ]),
    ),
    ...segment(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    0x11,
    0xff,
    0x00,
    0x22,
    0xff,
    0xd0,
    0x33,
    0xff,
    0xd9,
  ])
}

const standardXmp = (xml: string): Uint8Array =>
  segment(0xe1, new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0${xml}`))

const extendedXmp = (
  guid: string,
  packet: Uint8Array,
  offset: number,
  length: number,
): Uint8Array => {
  const header = new TextEncoder().encode(`http://ns.adobe.com/xmp/extension/\0${guid}`)
  const payload = new Uint8Array(header.length + 8 + length)
  payload.set(header)
  const view = new DataView(payload.buffer)
  view.setUint32(header.length, packet.length, false)
  view.setUint32(header.length + 4, offset, false)
  payload.set(packet.subarray(offset, offset + length), header.length + 8)
  return segment(0xe1, payload)
}

const mpfSegment = (
  primaryBytes: number,
  secondaryBytes: number,
  secondaryOffset: number,
  littleEndian = false,
): Uint8Array => {
  const payload = new Uint8Array(86)
  const view = new DataView(payload.buffer)
  payload.set(new TextEncoder().encode('MPF\0'), 0)
  payload.set(new TextEncoder().encode(littleEndian ? 'II' : 'MM'), 4)
  view.setUint16(6, 42, littleEndian)
  view.setUint32(8, 8, littleEndian)
  view.setUint16(12, 3, littleEndian)
  let entry = 14
  view.setUint16(entry, 0xb000, littleEndian)
  view.setUint16(entry + 2, 7, littleEndian)
  view.setUint32(entry + 4, 4, littleEndian)
  payload.set(new TextEncoder().encode('0100'), entry + 8)
  entry += 12
  view.setUint16(entry, 0xb001, littleEndian)
  view.setUint16(entry + 2, 4, littleEndian)
  view.setUint32(entry + 4, 1, littleEndian)
  view.setUint32(entry + 8, 2, littleEndian)
  entry += 12
  view.setUint16(entry, 0xb002, littleEndian)
  view.setUint16(entry + 2, 7, littleEndian)
  view.setUint32(entry + 4, 32, littleEndian)
  view.setUint32(entry + 8, 50, littleEndian)
  view.setUint32(54, 0x2003_0000, littleEndian)
  view.setUint32(58, primaryBytes, littleEndian)
  view.setUint32(62, 0, littleEndian)
  view.setUint16(66, 0, littleEndian)
  view.setUint16(68, 0, littleEndian)
  view.setUint32(70, 0, littleEndian)
  view.setUint32(74, secondaryBytes, littleEndian)
  view.setUint32(78, secondaryOffset, littleEndian)
  view.setUint16(82, 0, littleEndian)
  view.setUint16(84, 0, littleEndian)
  return segment(0xe2, payload)
}

const threeImageMpfSegment = (
  primaryBytes: number,
  secondBytes: number,
  secondOffset: number,
  thirdBytes: number,
  thirdOffset: number,
): Uint8Array => {
  const payload = new Uint8Array(102)
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
  view.setUint32(entry + 8, 3, false)
  entry += 12
  view.setUint16(entry, 0xb002, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 48, false)
  view.setUint32(entry + 8, 50, false)
  const values = [
    [0x2003_0000, primaryBytes, 0],
    [0, secondBytes, secondOffset],
    [0, thirdBytes, thirdOffset],
  ] as const
  for (let index = 0; index < values.length; index += 1) {
    const offset = 54 + index * 16
    const value = values[index]
    view.setUint32(offset, value?.[0] ?? 0, false)
    view.setUint32(offset + 4, value?.[1] ?? 0, false)
    view.setUint32(offset + 8, value?.[2] ?? 0, false)
  }
  return segment(0xe2, payload)
}

const compound = (
  littleEndian = false,
  options: Readonly<{
    readonly metadataAttributes?: string
    readonly metadataChildren?: string
    readonly gainComponents?: number
    readonly extraPrimarySegments?: readonly Uint8Array[]
  }> = {},
): Uint8Array => {
  const originalPrimary = minimalJpeg(16, 8)
  const gainMap = minimalJpeg(4, 2, true, options.gainComponents ?? 1)
  const metadataAttributes =
    options.metadataAttributes ??
    'g:Version="1.0" g:GainMapMin="0" g:GainMapMax="2" g:Gamma="1" ' +
      'g:OffsetSDR="0.015625" g:OffsetHDR="0.015625" ' +
      'g:HDRCapacityMin="0" g:HDRCapacityMax="2"'
  const xml =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:g="http://ns.adobe.com/hdr-gain-map/1.0/" ' +
    'xmlns:c="http://ns.google.com/photos/1.0/container/" ' +
    'xmlns:i="http://ns.google.com/photos/1.0/container/item/" ' +
    `${metadataAttributes}>${options.metadataChildren ?? ''}` +
    '<c:Directory><rdf:Seq>' +
    '<rdf:li><c:Item i:Semantic="Primary" i:Mime="image/jpeg"/></rdf:li>' +
    `<rdf:li><c:Item i:Semantic="GainMap" i:Mime="image/jpeg" i:Length="${gainMap.length}"/></rdf:li>` +
    '</rdf:Seq></c:Directory></rdf:Description></rdf:RDF></x:xmpmeta>'
  const xmp = standardXmp(xml)
  const extras = options.extraPrimarySegments ?? []
  const extraBytes = extras.reduce((total, item) => total + item.length, 0)
  const provisionalMpf = mpfSegment(0, gainMap.length, 0, littleEndian)
  const primaryBytes = originalPrimary.length + xmp.length + extraBytes + provisionalMpf.length
  const tiffOffset = 2 + xmp.length + extraBytes + 8
  const mpf = mpfSegment(primaryBytes, gainMap.length, primaryBytes - tiffOffset, littleEndian)
  return Uint8Array.from([
    ...originalPrimary.subarray(0, 2),
    ...xmp,
    ...extras.flatMap((item) => [...item]),
    ...mpf,
    ...originalPrimary.subarray(2),
    ...gainMap,
  ])
}

describe('HDR JPEG structure', () => {
  it('finds an EOI without treating stuffed bytes or restart markers as markers', async () => {
    const jpeg = minimalJpeg(7, 5)
    expect(await findJpegEnd(new MemorySource(jpeg))).toBe(jpeg.length)
  })

  it.each([false, true])(
    'enumerates %s-endian MPF ranges and parses prefix-independent XMP',
    async (littleEndian) => {
      const input = compound(littleEndian)
      const inspection = await inspectHdrJpeg(new MemorySource(input))
      expect(inspection.primaryDimensions).toMatchObject({ width: 16, height: 8 })
      expect(inspection.gainMapDimensions).toMatchObject({ width: 4, height: 2, progressive: true })
      expect(inspection.gainMap).toEqual({
        start: inspection.primary.end,
        end: input.length,
      })
      expect(inspection.mpf?.byteOrder).toBe(littleEndian ? 'little-endian' : 'big-endian')
      expect(inspection.gContainerItems.map((item) => item.semantic)).toEqual([
        'Primary',
        'GainMap',
      ])
      expect(inspection.ultraHdr).toMatchObject({
        version: '1.0',
        baseRendition: 'sdr',
        minimum: [0],
        maximum: [2],
        capacityMaximum: 2,
      })
    },
  )

  it('parses three-channel metadata from prefix-independent RDF sequences', async () => {
    const sequence = (name: string, values: readonly string[]): string =>
      `<g:${name}><rdf:Seq>${values.map((value) => `<rdf:li>${value}</rdf:li>`).join('')}</rdf:Seq></g:${name}>`
    const input = compound(false, {
      gainComponents: 3,
      metadataAttributes: 'g:Version="1.0" g:HDRCapacityMin="0" g:HDRCapacityMax="3"',
      metadataChildren:
        sequence('GainMapMin', ['-1', '-0.5', '0']) +
        sequence('GainMapMax', ['1', '2', '3']) +
        sequence('Gamma', ['1', '1.25', '1.5']) +
        sequence('OffsetSDR', ['0', '0.01', '0.02']) +
        sequence('OffsetHDR', ['0.03', '0.04', '0.05']),
    })
    const inspection = await inspectHdrJpeg(new MemorySource(input))
    expect(inspection.ultraHdr).toMatchObject({
      minimum: [-1, -0.5, 0],
      maximum: [1, 2, 3],
      gamma: [1, 1.25, 1.5],
      offsetSdr: [0, 0.01, 0.02],
      offsetHdr: [0.03, 0.04, 0.05],
    })
  })

  it('selects the semantic gain map instead of assuming the second MPF image', async () => {
    const primary = minimalJpeg(16, 8)
    const decoy = Uint8Array.from([
      ...minimalJpeg(2, 1).subarray(0, 2),
      ...segment(0xfe, new TextEncoder().encode('not a gain map')),
      ...minimalJpeg(2, 1).subarray(2),
    ])
    const gain = minimalJpeg(4, 2, false, 1)
    const xml =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:g="http://ns.adobe.com/hdr-gain-map/1.0/" xmlns:c="http://ns.google.com/photos/1.0/container/" xmlns:i="http://ns.google.com/photos/1.0/container/item/" ' +
      'g:Version="1.0" g:GainMapMax="2" g:HDRCapacityMax="2"><c:Directory><rdf:Seq>' +
      '<rdf:li><c:Item i:Semantic="Primary" i:Mime="image/jpeg"/></rdf:li>' +
      `<rdf:li><c:Item i:Semantic="GainMap" i:Mime="image/jpeg" i:Length="${gain.length}"/></rdf:li>` +
      '</rdf:Seq></c:Directory></rdf:Description></rdf:RDF></x:xmpmeta>'
    const xmp = standardXmp(xml)
    const provisional = threeImageMpfSegment(0, decoy.length, 0, gain.length, 0)
    const primaryBytes = primary.length + xmp.length + provisional.length
    const tiffOffset = 2 + xmp.length + 8
    const mpf = threeImageMpfSegment(
      primaryBytes,
      decoy.length,
      primaryBytes - tiffOffset,
      gain.length,
      primaryBytes + decoy.length - tiffOffset,
    )
    const input = Uint8Array.from([
      ...primary.subarray(0, 2),
      ...xmp,
      ...mpf,
      ...primary.subarray(2),
      ...decoy,
      ...gain,
    ])
    const inspection = await inspectHdrJpeg(new MemorySource(input))
    expect(inspection.mpf?.images).toHaveLength(3)
    expect(inspection.gainMap).toEqual({
      start: primaryBytes + decoy.length,
      end: input.length,
    })
    expect(inspection.gainMapDimensions).toMatchObject({ width: 4, height: 2, components: 1 })
  })

  it('rejects the unsupported HDR-base Ultra HDR XMP direction', async () => {
    await expect(
      inspectHdrJpeg(
        new MemorySource(
          compound(false, {
            metadataAttributes:
              'g:Version="1.0" g:BaseRenditionIsHDR="True" g:GainMapMax="2" ' +
              'g:HDRCapacityMax="2"',
          }),
        ),
      ),
    ).rejects.toThrow(/SDR base rendition/u)
  })

  it('reassembles complete out-of-order extended XMP and rejects missing chunks', async () => {
    const packet = new TextEncoder().encode(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        '<rdf:Description xmlns:h="http://ns.adobe.com/hdr-gain-map/1.0/" ' +
        'h:Version="1.0" h:GainMapMax="2" h:HDRCapacityMax="2"/>' +
        '</rdf:RDF></x:xmpmeta>',
    )
    const guid = createHash('md5').update(packet).digest('hex').toUpperCase()
    const split = Math.floor(packet.length / 2)
    const declaration = `xmlns:n="http://ns.adobe.com/xmp/note/" n:HasExtendedXMP="${guid}"`
    const input = compound(false, {
      metadataAttributes: declaration,
      extraPrimarySegments: [
        extendedXmp(guid, packet, split, packet.length - split),
        extendedXmp(guid, packet, 0, split),
      ],
    })
    expect((await inspectHdrJpeg(new MemorySource(input))).ultraHdr?.maximum).toEqual([2])
    await expect(
      inspectHdrJpeg(new MemorySource(compound(false, { metadataAttributes: declaration }))),
    ).rejects.toThrow(/chunks are missing/u)
  })

  it('rejects DTDs, duplicate HDR fields, and a conflicting GContainer length', async () => {
    const dtd = compound()
    const xmlStart = new TextDecoder().decode(dtd).indexOf('<x:xmpmeta')
    expect(xmlStart).toBeGreaterThan(0)
    const withDoctype = Uint8Array.from(dtd)
    withDoctype.set(new TextEncoder().encode('<!DOCTYPE'), xmlStart)
    await expect(inspectHdrJpeg(new MemorySource(withDoctype))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const conflicting = compound()
    const text = new TextDecoder().decode(conflicting)
    const lengthText = /i:Length="(\d+)"/u.exec(text)?.[1]
    expect(lengthText).toBeDefined()
    if (lengthText) {
      const offset = text.indexOf(lengthText)
      const replacement = String(Number(lengthText) - 1).padStart(lengthText.length, '0')
      conflicting.set(new TextEncoder().encode(replacement), offset)
    }
    await expect(inspectHdrJpeg(new MemorySource(conflicting))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects overlapping and out-of-source MPF ranges', async () => {
    const input = compound()
    const corrupted = Uint8Array.from(input)
    const signature = new TextEncoder().encode('MPF\0')
    let mpf = -1
    for (let index = 0; index <= corrupted.length - signature.length; index += 1) {
      if (signature.every((value, offset) => corrupted[index + offset] === value)) {
        mpf = index
        break
      }
    }
    expect(mpf).toBeGreaterThan(0)
    new DataView(corrupted.buffer).setUint32(mpf + 78, 1, false)
    await expect(inspectHdrJpeg(new MemorySource(corrupted))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
})
