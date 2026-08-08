import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { capabilityClaims, readCapabilityManifest } from '../scripts/capability-manifest.ts'
import { avifCodec } from '../src/codecs/avif.ts'
import { bmpCodec } from '../src/codecs/bmp.ts'
import { gifCodec } from '../src/codecs/gif.ts'
import { heifCodec } from '../src/codecs/heif.ts'
import { icoCodec } from '../src/codecs/ico.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { jpeg2000Codec } from '../src/codecs/jpeg2000.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { tiffCodec } from '../src/codecs/tiff.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import type { ImageCodec } from '../src/codec.ts'
import codecCapabilityExpectations from './generated/capability-expectations.json' with {
  type: 'json',
}

const runtimeCodecs: readonly ImageCodec[] = [
  jpegCodec,
  pngCodec,
  webpCodec,
  bmpCodec,
  tiffCodec,
  gifCodec,
  icoCodec,
  jpeg2000Codec,
  avifCodec,
  heifCodec,
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
})
