import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import {
  defaultTiffCompetitorCorpora,
  parseTiffCompetitorCli,
} from '../scripts/compare-tiff-competitors.ts'
import { compareTiffFile, tiffCompetitorEngines } from '../scripts/compare-tiff-worker.ts'

describe('TIFF competitor conformance harness', () => {
  it('scores every competitor against independent exact RGBA output', async () => {
    const results = await Promise.all(
      tiffCompetitorEngines.map(async (engine) => ({
        engine,
        result: await compareTiffFile(engine, 'benchmark/corpus/files/libtiff-rgb-3c-8b.tiff'),
      })),
    )

    expect(results.map(({ engine, result }) => ({ engine, status: result.status }))).toEqual(
      tiffCompetitorEngines.map((engine) => ({ engine, status: 'success' })),
    )
    for (const { result } of results) {
      if (result.status !== 'success') throw new Error(`Unexpected result: ${result.status}`)
      expect(result.exact).toBe(true)
      expect(result.mismatchedPixels).toBe(0)
      expect(result.maximumChannelDelta).toBe(0)
      expect(result.rootMeanSquareError).toBe(0)
    }
  })

  it('includes native-raster and malformed-input coverage by default', async () => {
    expect(parseTiffCompetitorCli([]).corpusDirectories).toEqual(defaultTiffCompetitorCorpora)

    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-tiff-comparison-'))
    const robustnessDirectory = join(directory, 'robustness')
    const file = join(robustnessDirectory, 'truncated.tif')
    await mkdir(robustnessDirectory)
    await writeFile(file, Uint8Array.of(0x49, 0x49, 0x2a))
    try {
      const result = await compareTiffFile('purejsimage', file)
      expect(result.status).toBe('malformed-rejected')
      expect(result.comparisonMode).toBe('robustness')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps every generated failure detail inside its Markdown table row', async () => {
    const report = await readFile('benchmark/results/tiff-competitor-conformance.md', 'utf8')
    const details = report.split('## Non-exact, failed, and malformed-accepted cases')[1]
    expect(details).toBeDefined()
    const nonemptyLines = (details ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    expect(nonemptyLines.every((line) => line.startsWith('|'))).toBe(true)
  })
})
