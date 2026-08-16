import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  prepareScientificFixture,
  scientificFixtureDefinitions,
} from '../benchmark/scientific-readers/catalog.ts'
import {
  scientificCompetitorEngines,
  scientificCompetitorWorkloads,
} from '../benchmark/scientific-readers/competitors.ts'

describe('scientific competitor benchmark contract', () => {
  it('keeps every package exact-pinned and outside the published dependency tree', async () => {
    const manifest = JSON.parse(
      await readFile('benchmark/competitors-js/package.json', 'utf8'),
    ) as { dependencies?: Record<string, string> }
    expect(manifest.dependencies).toBeDefined()
    for (const version of Object.values(manifest.dependencies ?? {})) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/u)
    }
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('fitsjs')
  })

  it('declares valid and unsupported boundaries for every direct engine', () => {
    const workloadIds = new Set(scientificCompetitorWorkloads.map(({ id }) => id))
    expect(scientificCompetitorEngines).toHaveLength(10)
    expect(scientificCompetitorEngines[0]).toMatchObject({
      id: 'purejsimage',
      implementationClass: 'pure-javascript',
      inputModel: 'ImageSource',
      lazyOrSelectedReads: true,
      copiesCompleteInputBeforeOpen: false,
    })
    for (const engine of scientificCompetitorEngines) {
      expect(engine.packageVersion).toMatch(/^\d+\.\d+\.\d+$/u)
      expect(engine.supportedWorkloadIds.length).toBeGreaterThan(0)
      expect(Object.keys(engine.unsupportedReasons).length).toBeGreaterThan(0)
      expect(engine.supportedWorkloadIds.every((id) => workloadIds.has(id))).toBe(true)
      expect(engine.supportedWorkloadIds).not.toContain('fitsjs')
    }
  })

  it('keeps every scorecard workload attached to a prepared fixture', async () => {
    const fixtureIds = new Set(scientificFixtureDefinitions.map(({ id }) => id))
    for (const workload of scientificCompetitorWorkloads) {
      expect(fixtureIds).toContain(workload.fixtureId)
    }
    const nifti = await prepareScientificFixture('nifti')
    const bytes = await readFile(nifti.resources[0]?.path ?? '')
    expect(bytes.byteLength).toBe(360)
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(46, true)).toBe(
      1,
    )
  })

  it('places small TIFF tiles after the first 64 KiB source page', async () => {
    const fixture = await prepareScientificFixture('tiff-small-tiles')
    const bytes = await readFile(fixture.resources[0]?.path ?? '')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ifdOffset = view.getUint32(4, true)
    const entryCount = view.getUint16(ifdOffset, true)
    let tileOffsetsOffset = 0
    let tileCount = 0
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12
      const tag = view.getUint16(entryOffset, true)
      if (tag === 324) {
        tileCount = view.getUint32(entryOffset + 4, true)
        tileOffsetsOffset = view.getUint32(entryOffset + 8, true)
      }
    }
    expect(tileCount).toBeGreaterThan(1)
    const firstTileOffset = view.getUint32(tileOffsetsOffset, true)
    expect(firstTileOffset).toBeGreaterThanOrEqual(65_536)
    expect(bytes.byteLength).toBeGreaterThan(firstTileOffset)
  })
})
