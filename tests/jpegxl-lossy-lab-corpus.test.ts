import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import {
  deterministicCrop,
  type PhotoSource,
  photoCategories,
  selectDevelopmentCorpus,
  selectHoldoutForPromotion,
  selectSecondaryDevelopmentCorpus,
} from '../benchmark/jpegxl/lossy-lab/corpus.ts'
import { prepareCorpusFixture } from '../benchmark/jpegxl/lossy-lab/corpus-worker.ts'

const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

describe('lossy lab photographic corpus', () => {
  it('selects exactly the prescribed development photos, with a fixed 16-image screen', () => {
    const corpus = selectDevelopmentCorpus()
    expect(corpus.normal).toHaveLength(64)
    expect(corpus.screen).toHaveLength(16)
    expect(corpus.secondaryIds).toHaveLength(56)
    expect(new Set(corpus.normal.map((entry) => entry.category))).toEqual(new Set(photoCategories))
    expect(corpus.normal.every((entry) => entry.split === 'development')).toBe(true)
    expect(corpus.screen).toEqual(corpus.normal.slice(0, 16))
    expect(corpus.screen.map((entry) => entry.id)).toEqual([
      'im26-3012',
      'im26-1052',
      'im26-1610',
      'im26-3312',
      'im26-1002',
      'im26-3014',
      'im26-1026',
      'im26-1626',
      'im26-2002',
      'im26-2004',
      'im26-1622',
      'im26-1210',
      'im26-1634',
      'im26-3000',
      'im26-3306',
      'im26-2012',
    ])
    expect(corpus.screen.filter((entry) => entry.largeGateRepresentative)).toHaveLength(2)
    expect(selectDevelopmentCorpus()).toEqual(corpus)
    expect(corpus.reductions).toEqual([])
    expect('holdout' in corpus).toBe(false)
    expect(corpus.version).toBe('031883090ed2cee64e9482432c0669879978808393539a996d3fa965400949ff')
  })

  it('keeps all 56 secondary development cases separate from photos and holdout', () => {
    const corpus = selectSecondaryDevelopmentCorpus()
    const photos = selectDevelopmentCorpus()
    expect(corpus.fixtures).toHaveLength(56)
    expect(new Set(corpus.fixtures.map((entry) => entry.id))).toEqual(new Set(photos.secondaryIds))
    expect(corpus.fixtures.every((entry) => entry.split === 'development')).toBe(true)
    expect(
      corpus.fixtures.every(
        (entry) => !photoCategories.some((category) => category === entry.category),
      ),
    ).toBe(true)
    expect(
      corpus.fixtures.every((entry) => entry.crop.width <= 512 && entry.crop.height <= 512),
    ).toBe(true)
    expect(corpus.fixtures[0]?.id).toBe('im26-6610')
    expect(corpus.reductions).toEqual([])
    expect(selectSecondaryDevelopmentCorpus()).toEqual(corpus)
    const reduced = selectSecondaryDevelopmentCorpus({ normalCount: 4, normalEdge: 256 })
    expect(reduced.fixtures).toHaveLength(4)
    expect(
      reduced.fixtures.every((entry) => entry.crop.width <= 256 && entry.crop.height <= 256),
    ).toBe(true)
    expect(reduced.reductions.filter((entry) => entry.kind === 'full-lab-count')).toHaveLength(52)
    expect(reduced.reductions.filter((entry) => entry.kind === 'normal-crop-size')).toHaveLength(4)
    expect(reduced.version).not.toBe(corpus.version)
    expect(() => selectSecondaryDevelopmentCorpus({ normalCount: 57 })).toThrow()
  })

  it('selects six hash-chosen development originals and all four prior watch references', () => {
    const corpus = selectDevelopmentCorpus()
    expect(corpus.watch).toHaveLength(10)
    expect(corpus.watch.slice(0, 6).every((entry) => entry.split === 'development')).toBe(true)
    expect(corpus.watch.slice(0, 6).map((entry) => entry.id)).toEqual([
      'im26-2004',
      'im26-2400',
      'im26-1026',
      'im26-1472',
      'im26-2012',
      'im26-1212',
    ])
    expect(corpus.watch.slice(6).map((entry) => entry.id)).toEqual([
      'prior-12mp-im26-1416',
      'portrait-2400x3000',
      'tundra-4000x3000',
      'earthrise-2400x2400',
    ])
    for (const entry of corpus.watch)
      expect(entry.crop).toEqual({ x: 0, y: 0, width: entry.width, height: entry.height })
  })

  it('makes holdout a separate promotion-only selection', () => {
    const holdout = selectHoldoutForPromotion()
    expect(holdout).toHaveLength(63)
    expect(holdout.every((entry) => entry.split === 'holdout')).toBe(true)
    const development = new Set(selectDevelopmentCorpus().normal.map((entry) => entry.id))
    expect(holdout.some((entry) => development.has(entry.id))).toBe(false)
  })

  it('records count and crop reductions without silently deleting misses', () => {
    const corpus = selectDevelopmentCorpus({
      normalCount: 16,
      screenCount: 8,
      normalEdge: 256,
      largeCount: 0,
    })
    expect(corpus.normal).toHaveLength(16)
    expect(corpus.screen).toHaveLength(8)
    expect(corpus.reductions.filter((entry) => entry.kind === 'full-lab-count')).toHaveLength(48)
    expect(corpus.reductions.filter((entry) => entry.kind === 'screen-count')).toHaveLength(8)
    expect(corpus.reductions.filter((entry) => entry.kind === 'large-crop-count')).toHaveLength(2)
    expect(corpus.version).not.toBe(selectDevelopmentCorpus().version)
    expect(
      corpus.normal.every((entry) => entry.crop.width <= 256 && entry.crop.height <= 256),
    ).toBe(true)
  })

  it('keeps crops in bounds and preserves stored pixels without resizing', () => {
    const source: PhotoSource = {
      id: 'tiny',
      split: 'development',
      category: 'test',
      sourcePath: 'tiny.png',
      sourceSha256: 'a'.repeat(64),
      sourceBytes: null,
      width: 7,
      height: 5,
      license: 'test',
    }
    expect(deterministicCrop(source, 10)).toEqual({ x: 0, y: 0, width: 7, height: 5 })
    for (const entry of selectDevelopmentCorpus().normal) {
      expect(entry.crop.x).toBeGreaterThanOrEqual(0)
      expect(entry.crop.y).toBeGreaterThanOrEqual(0)
      expect(entry.crop.x + entry.crop.width).toBeLessThanOrEqual(entry.width)
      expect(entry.crop.y + entry.crop.height).toBeLessThanOrEqual(entry.height)
    }
    expect(() => deterministicCrop(source, 0)).toThrow()
    expect(() => selectDevelopmentCorpus({ screenCount: 17 })).toThrow()
    expect(() => selectDevelopmentCorpus({ normalCount: 4, screenCount: 8 })).toThrow()
  })

  it('prepares a first-party crop and checks source identity before writing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jpegxl-lab-crop-'))
    try {
      const pixels = new Uint8Array(8 * 6 * 4)
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 8; x++) pixels.set([x * 20, y * 30, x + y, 255], (y * 8 + x) * 4)
      const fixturePng = new PNG({ width: 8, height: 6 })
      fixturePng.data.set(pixels)
      const source = PNG.sync.write(fixturePng)
      const path = join(directory, 'source.png')
      await writeFile(path, source)
      const fixture = {
        id: 'test-photo',
        split: 'development' as const,
        category: 'test',
        sourcePath: path,
        sourceSha256: hash(source),
        sourceBytes: source.length,
        width: 8,
        height: 6,
        license: 'test',
        crop: { x: 2, y: 1, width: 3, height: 4 },
        largeGateRepresentative: false,
      }
      const result = await prepareCorpusFixture(fixture, directory)
      const output = await readFile(result.pngPath)
      expect(hash(output)).toBe(result.pngSha256)
      const decoded = PNG.sync.read(output)
      expect([decoded.width, decoded.height]).toEqual([3, 4])
      for (let y = 0; y < 4; y++) {
        const sourceOffset = ((y + 1) * 8 + 2) * 4
        expect(new Uint8Array(decoded.data.subarray(y * 12, (y + 1) * 12))).toEqual(
          pixels.subarray(sourceOffset, sourceOffset + 12),
        )
      }
      await expect(
        prepareCorpusFixture({ ...fixture, sourceSha256: '0'.repeat(64) }, directory),
      ).rejects.toThrow('Source identity changed')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
