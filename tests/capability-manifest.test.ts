import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { capabilityClaims, readCapabilityManifest } from '../scripts/capability-manifest.ts'
import { avifCodec } from '../src/codecs/avif.ts'
import { bmpCodec } from '../src/codecs/bmp.ts'
import { gifCodec } from '../src/codecs/gif.ts'
import { hdrCodec } from '../src/codecs/hdr.ts'
import { heifCodec } from '../src/codecs/heif.ts'
import { icoCodec } from '../src/codecs/ico.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { jpeg2000Codec } from '../src/codecs/jpeg2000.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { netpbmCodec } from '../src/codecs/netpbm.ts'
import { qoiCodec } from '../src/codecs/qoi.ts'
import { tiffCodec } from '../src/codecs/tiff.ts'
import { tgaCodec } from '../src/codecs/tga.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import type { ImageCodec } from '../src/codec.ts'
import { aperioSvsReaderDescriptor } from '../src/scientific/readers/aperio-svs.ts'
import { blockfileReaderDescriptor } from '../src/scientific/readers/blockfile.ts'
import { bmpReaderDescriptor } from '../src/scientific/readers/bmp.ts'
import { cbfReaderDescriptor } from '../src/scientific/readers/cbf.ts'
import { digitalMicrographReaderDescriptor } from '../src/scientific/readers/digital-micrograph.ts'
import { digitalSurfReaderDescriptor } from '../src/scientific/readers/digital-surf.ts'
import { ebsdTextReaderDescriptor } from '../src/scientific/readers/ebsd-text.ts'
import { emsaReaderDescriptor } from '../src/scientific/readers/emsa.ts'
import { enviReaderDescriptor } from '../src/scientific/readers/envi.ts'
import { fitsReaderDescriptor } from '../src/scientific/readers/fits.ts'
import { gsfReaderDescriptor } from '../src/scientific/readers/gsf.ts'
import { igorBinaryWaveReaderDescriptor } from '../src/scientific/readers/igor-binary-wave.ts'
import { jpegReaderDescriptor } from '../src/scientific/readers/jpeg.ts'
import { jp2ReaderDescriptor } from '../src/scientific/readers/jp2.ts'
import { mrcReaderDescriptor } from '../src/scientific/readers/mrc.ts'
import { metaImageReaderDescriptor } from '../src/scientific/readers/meta-image.ts'
import { mibReaderDescriptor } from '../src/scientific/readers/mib.ts'
import { nanonisSxmReaderDescriptor } from '../src/scientific/readers/nanonis-sxm.ts'
import { ncemEmdReaderDescriptor } from '../src/scientific/readers/ncem-emd.ts'
import { niftiReaderDescriptor } from '../src/scientific/readers/nifti.ts'
import { npyReaderDescriptor } from '../src/scientific/readers/npy.ts'
import { nrrdReaderDescriptor } from '../src/scientific/readers/nrrd.ts'
import { omeTiffReaderDescriptor } from '../src/scientific/readers/ome-tiff.ts'
import { pngReaderDescriptor } from '../src/scientific/readers/png.ts'
import { rplReaderDescriptor } from '../src/scientific/readers/rpl.ts'
import { tiffReaderDescriptor } from '../src/scientific/readers/tiff.ts'
import { tiaEmiReaderDescriptor } from '../src/scientific/readers/tia-emi.ts'
import { tiaSerReaderDescriptor } from '../src/scientific/readers/tia-ser.ts'
import { veloxEmdReaderDescriptor } from '../src/scientific/readers/velox-emd.ts'
import { webpReaderDescriptor } from '../src/scientific/readers/webp.ts'
import { x3pReaderDescriptor } from '../src/scientific/readers/x3p.ts'
import type { ScientificReaderDescriptor } from '../src/scientific/reader.ts'
import codecCapabilityExpectations from './generated/capability-expectations.json' with {
  type: 'json',
}

const runtimeCodecs: readonly ImageCodec[] = [
  jpegCodec,
  jpegxlCodec,
  pngCodec,
  webpCodec,
  bmpCodec,
  tiffCodec,
  gifCodec,
  icoCodec,
  jpeg2000Codec,
  avifCodec,
  hdrCodec,
  netpbmCodec,
  qoiCodec,
  tgaCodec,
  heifCodec,
]

const runtimeScientificReaders: readonly ScientificReaderDescriptor[] = [
  gsfReaderDescriptor,
  enviReaderDescriptor,
  fitsReaderDescriptor,
  mrcReaderDescriptor,
  cbfReaderDescriptor,
  pngReaderDescriptor,
  jpegReaderDescriptor,
  webpReaderDescriptor,
  bmpReaderDescriptor,
  jp2ReaderDescriptor,
  tiffReaderDescriptor,
  omeTiffReaderDescriptor,
  aperioSvsReaderDescriptor,
  digitalMicrographReaderDescriptor,
  tiaEmiReaderDescriptor,
  tiaSerReaderDescriptor,
  ncemEmdReaderDescriptor,
  veloxEmdReaderDescriptor,
  nanonisSxmReaderDescriptor,
  igorBinaryWaveReaderDescriptor,
  digitalSurfReaderDescriptor,
  x3pReaderDescriptor,
  rplReaderDescriptor,
  emsaReaderDescriptor,
  nrrdReaderDescriptor,
  metaImageReaderDescriptor,
  niftiReaderDescriptor,
  npyReaderDescriptor,
  blockfileReaderDescriptor,
  mibReaderDescriptor,
  ebsdTextReaderDescriptor,
]

describe('generated codec capability contract', () => {
  it('matches published decode and encode support to the codec implementations', () => {
    const codecsByFormat = new Map(runtimeCodecs.map((codec) => [codec.format, codec]))
    expect([...codecsByFormat.keys()].sort()).toEqual(
      codecCapabilityExpectations.codecs.map(({ format }) => format).sort(),
    )

    for (const expectation of codecCapabilityExpectations.codecs) {
      const codec = codecsByFormat.get(expectation.format)
      if (!codec) throw new Error(`Missing runtime codec for ${expectation.format}`)
      expect(codec.createDecoder !== undefined, `${expectation.id} decoder`).toBe(
        expectation.decoder,
      )
      expect(codec.createEncoder !== undefined, `${expectation.id} encoder`).toBe(
        expectation.encoder,
      )
    }
  })

  it('backs every published implementation with repository test evidence', () => {
    for (const expectation of codecCapabilityExpectations.codecs) {
      expect(expectation.evidence.length, `${expectation.id} evidence`).toBeGreaterThan(0)
      for (const path of expectation.evidence) {
        const source = readFileSync(path, 'utf8')
        expect(source, `${expectation.id} evidence in ${path}`).toMatch(
          /\b(?:it|test)(?:\.each)?\(/,
        )
      }
    }
  })

  it('requires every codec to declare its independent lossy-pixel validation contract', async () => {
    const manifest = await readCapabilityManifest()
    for (const codec of manifest.codecs) {
      const validation = codec.lossyPixelValidation
      if (validation.status === 'not-applicable') {
        expect(validation.rationale, `${codec.id} lossy validation rationale`).not.toBe('')
        continue
      }
      expect(validation.oracle, `${codec.id} lossy oracle`).not.toBe('')
      expect(validation.tolerance, `${codec.id} lossy tolerance`).not.toBe('')
      expect(validation.evidence.length, `${codec.id} lossy oracle evidence`).toBeGreaterThan(0)
      for (const path of validation.evidence) {
        expect(
          readFileSync(path, 'utf8').length,
          `${codec.id} lossy evidence in ${path}`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('lists the registered limited JPEG XL pixel decoder without claiming broader support', async () => {
    const manifest = await readCapabilityManifest()
    const jpegxl = manifest.codecs.find(({ id }) => id === 'jpegxl')
    if (!jpegxl) throw new Error('Missing JPEG XL capability manifest')

    expect(jpegxl.packageFormat).toBe('jpegxl')
    expect(readFileSync('README.md', 'utf8')).toContain('| JPEG XL | Limited | No |')
    expect(readFileSync('docs-astro/src/pages/codecs.astro', 'utf8')).toContain(
      '<strong>JPEG XL</strong>',
    )

    const llmsGuide = readFileSync('docs-astro/public/llms.txt', 'utf8')
    expect(llmsGuide).toContain('### JPEG XL')
    expect(llmsGuide).toContain("from 'purejsimage/codecs/jpegxl'")
    expect(codecCapabilityExpectations.codecs).toContainEqual(
      expect.objectContaining({ id: 'jpegxl', format: 'jpegxl', decoder: true, encoder: false }),
    )
  })

  it('keeps corrected PNG and WebP metadata claims in the authoritative manifest', async () => {
    const manifest = await readCapabilityManifest()
    for (const id of ['png', 'webp']) {
      const codec = manifest.codecs.find((candidate) => candidate.id === id)
      if (!codec) throw new Error(`Missing ${id} capability manifest`)
      const implemented = capabilityClaims(codec.document)
        .filter(({ status }) => status === 'supported')
        .map(({ text }) => text)
        .join('\n')
      expect(implemented).toContain('ICC')
      expect(implemented).toContain('EXIF')
      expect(implemented).toContain('preserv')
    }
  })

  it('documents the implemented lossless WebP size controls', async () => {
    const manifest = await readCapabilityManifest()
    const webp = manifest.codecs.find(({ id }) => id === 'webp')
    if (!webp) throw new Error('Missing WebP capability manifest')
    expect(webp.boundary).not.toContain('not yet size-competitive')
    expect(webp.recommendation).toContain('effort 6')
    expect(webp.recommendation).toContain('lossless WebP can be larger than PNG')
    expect(webp.document).toContain('For photographs, prefer lossy WebP')
    expect(webp.document).toContain('- [x] Spatially varying Huffman entropy groups')
    expect(webp.document).toContain(
      '- [x] Cross-color and packed color-indexing transform selection',
    )
    expect(webp.document).toContain('- [x] Near-lossless preprocessing')
  })
})

describe('generated scientific reader capability contract', () => {
  it('matches every published reader descriptor and package export', async () => {
    const manifest = await readCapabilityManifest()
    const descriptors = new Map(
      runtimeScientificReaders.map((descriptor) => [descriptor.id, descriptor]),
    )
    expect([...descriptors.keys()].sort()).toEqual(
      manifest.scientificReaders.map(({ id }) => id).sort(),
    )
    const packageValue: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
    if (
      typeof packageValue !== 'object' ||
      packageValue === null ||
      !('exports' in packageValue) ||
      typeof packageValue.exports !== 'object' ||
      packageValue.exports === null
    ) {
      throw new Error('package.json exports are missing')
    }
    for (const reader of manifest.scientificReaders) {
      const descriptor = descriptors.get(reader.id)
      if (descriptor === undefined) throw new Error(`Missing runtime reader ${reader.id}`)
      expect(descriptor).toMatchObject({
        id: reader.id,
        version: reader.version,
        format: reader.format,
        extensions: reader.extensions,
        mediaTypes: reader.mediaTypes,
      })
      const packageKey = `.${reader.packageExport.slice('purejsimage'.length)}`
      expect(packageKey in packageValue.exports, reader.packageExport).toBe(true)
    }
  })

  it('backs reader claims with repository evidence and fixture provenance', async () => {
    const manifest = await readCapabilityManifest()
    for (const reader of manifest.scientificReaders) {
      for (const path of reader.evidence) {
        expect(readFileSync(path, 'utf8'), `${reader.id} evidence in ${path}`).toMatch(
          /\b(?:it|test)(?:\.each)?\(/,
        )
      }
      for (const path of reader.fixtures) {
        expect(
          readFileSync(path).byteLength,
          `${reader.id} fixture evidence in ${path}`,
        ).toBeGreaterThan(0)
      }
    }
  })
})
