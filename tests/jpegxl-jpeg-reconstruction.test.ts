import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import manifest from '../benchmark/jpegxl/jpeg-reconstruction-manifest.json' with { type: 'json' }
import { inspectJpegXlSource } from '../src/codecs/jpegxl-container.ts'
import { parseJpegXlJpegReconstructionHeader } from '../src/codecs/jpegxl-jpeg-reconstruction.ts'
import { resolveJpegXlLimits } from '../src/codecs/jpegxl-limits.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'
import { MemorySource } from '../src/source.ts'

const fixture = new Uint8Array(
  readFileSync('benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/baseline-yuv420.jxl'),
)

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const readJbrd = async (): Promise<Uint8Array> => {
  const source = new MemorySource(fixture)
  const structure = await inspectJpegXlSource(source, resolveJpegXlLimits())
  const box = structure.metadataBoxes.find(({ type }) => type === 'jbrd')
  if (!box) throw new Error('Pinned JPEG reconstruction fixture has no jbrd box')
  const contentStart = box.offset + box.length - box.payloadBytes
  return source.read(contentStart, box.payloadBytes)
}

describe('JPEG XL JPEG reconstruction metadata', () => {
  it('pins a byte-exact independent libjxl reconstruction fixture', () => {
    expect(manifest.revision).toMatch(/^[0-9a-f]{40}$/u)
    expect(manifest.sourceArchiveSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(manifest.fixtures).toEqual([
      expect.objectContaining({
        id: 'baseline-yuv420',
        sourceSha256: manifest.fixtures[0]?.reconstructedJpegSha256,
        exact: true,
      }),
    ])
    const entry = manifest.fixtures[0]
    if (!entry) throw new Error('Pinned JPEG reconstruction manifest is empty')
    expect(sha256(fixture)).toBe(entry.jxlSha256)
    expect(sha256(new Uint8Array(readFileSync(entry.source)))).toBe(entry.sourceSha256)
  })

  it('parses the bounded jbrd header without decoding image coefficients', async () => {
    const reconstruction = parseJpegXlJpegReconstructionHeader(
      await readJbrd(),
      resolveJpegXlLimits(),
    )

    expect(reconstruction.markerOrder).toEqual([
      0xe0, 0xe1, 0xdb, 0xc2, 0xc4, 0xda, 0xc4, 0xda, 0xc4, 0xda, 0xc4, 0xda, 0xc4, 0xda, 0xc4,
      0xda, 0xd9,
    ])
    expect(reconstruction.appMarkers).toEqual([
      { type: 'unknown', byteLength: 17 },
      { type: 'exif', byteLength: 99 },
    ])
    expect(reconstruction.componentIds).toEqual([1, 2, 3])
    expect(reconstruction.componentQuantizationTables).toEqual([0, 1, 1])
    expect(reconstruction.huffmanTables).toHaveLength(6)
    expect(reconstruction.scans).toHaveLength(6)
    expect(
      reconstruction.scans.map(({ spectralStart, spectralEnd }) => [spectralStart, spectralEnd]),
    ).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [1, 63],
      [1, 63],
      [1, 63],
    ])
    expect(reconstruction.compressedDataOffset).toBe(112)
    expect(reconstruction.compressedDataBytes).toBe(21)
  })

  it('reports validated reconstruction metadata separately from coefficient eligibility', async () => {
    await expect(inspectJpegXl(fixture)).resolves.toMatchObject({
      width: 320,
      height: 240,
      encoding: 'vardct',
      jpegReconstruction: 'metadata-valid',
      exactReconstructionEligibility: 'requires-coefficient-validation',
    })
  })

  it('enforces explicit reconstruction marker limits', async () => {
    const payload = await readJbrd()
    expect(() =>
      parseJpegXlJpegReconstructionHeader(payload, resolveJpegXlLimits({ maxJpegMarkers: 16 })),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
  })

  it('rejects truncated reconstruction metadata', async () => {
    const payload = await readJbrd()
    expect(() =>
      parseJpegXlJpegReconstructionHeader(payload.subarray(0, 20), resolveJpegXlLimits()),
    ).toThrowError(expect.objectContaining({ code: 'TRUNCATED_INPUT' }))
  })
})
