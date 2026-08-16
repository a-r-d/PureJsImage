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
    expect(scientificCompetitorEngines).toHaveLength(9)
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
})
