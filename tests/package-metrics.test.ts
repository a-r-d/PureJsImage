import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import capabilityManifestJson from '../capabilities/manifest.json' with { type: 'json' }
import packageMetricsJson from '../benchmark/generated/package-metrics.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import {
  codecTargetId,
  createCompetitorBundleTargets,
  createPureJsImageEntryTargets,
  scientificReaderTargetId,
} from '../scripts/bundle-size-config.ts'
import { parseCapabilityManifest } from '../scripts/capability-manifest.ts'
import {
  parsePackageMetrics,
  packageMetricsPath,
  serializePackageMetrics,
} from '../scripts/bundle-size.ts'
import {
  parsePackageJsonSurface,
  validatePackageAndBundleSurfaces,
} from '../scripts/validate-package-surfaces.ts'

const manifest = parseCapabilityManifest(capabilityManifestJson)
const metrics = parsePackageMetrics(packageMetricsJson)
const pureTargets = createPureJsImageEntryTargets(manifest)
const competitorTargets = createCompetitorBundleTargets(manifest)
const targetIds = new Set(metrics.targets.map(({ id }) => id))

describe('generated package metrics contract', () => {
  it('keeps scientific reader exports, all-readers, and measured targets aligned', async () => {
    await validatePackageAndBundleSurfaces({
      manifest,
      packageJson: parsePackageJsonSurface(packageJson),
      repositoryDirectory: process.cwd(),
      targets: [...pureTargets, ...competitorTargets],
    })

    const readerTargetIds = manifest.scientificReaders.map(({ packageExport }) =>
      scientificReaderTargetId(packageExport),
    )
    expect(
      metrics.targets.filter(({ id }) => id.startsWith('scientific-reader-')).map(({ id }) => id),
    ).toEqual(readerTargetIds)
    expect(metrics.scientificReaders.map(({ targetId }) => targetId)).toEqual(readerTargetIds)
    expect(
      metrics.scientificReaders.every(
        ({ demoWired, id }) => demoWired === metrics.liveDemoReaderIds.includes(id),
      ),
    ).toBe(true)
    expect(metrics.scientificReaderGroups.flatMap(({ readerIds }) => readerIds).sort()).toEqual(
      metrics.scientificReaders.map(({ id }) => id).sort(),
    )
    expect(targetIds.has('scientific-readers-all')).toBe(true)
  })

  it('measures every public codec export and keeps HEIF experimental', () => {
    const publicCodecs = manifest.codecs.filter(({ packageFormat }) => packageFormat !== undefined)
    const stableCodecs = publicCodecs.filter(({ experimental }) => !experimental)
    const experimentalCodecs = publicCodecs.filter(({ experimental }) => experimental)
    expect(metrics.codecs.map(({ id }) => id)).toEqual(publicCodecs.map(({ id }) => id))
    expect(publicCodecs.every((codec) => targetIds.has(codecTargetId(codec)))).toBe(true)
    expect(metrics.codecs.filter(({ experimental }) => !experimental)).toHaveLength(
      stableCodecs.length,
    )
    expect(metrics.codecs.filter(({ experimental }) => experimental)).toHaveLength(
      experimentalCodecs.length,
    )

    const allCodecsSource = readFileSync('src/codec-entries/all.ts', 'utf8')
    expect(allCodecsSource).not.toContain('heic')
    expect(metrics.targets.find(({ id }) => id === 'codecs-all')?.codecs).toEqual(
      stableCodecs.map(({ name }) => name),
    )
    expect(metrics.targets.find(({ id }) => id === 'codecs-web')?.codecs).toEqual([
      'JPEG',
      'PNG',
      'WebP',
      'AVIF',
    ])
    expect(metrics.codecs.filter(({ experimental }) => experimental).map(({ id }) => id)).toEqual(
      experimentalCodecs.map(({ id }) => id),
    )
  })

  it('records deterministic current data without machine paths or timestamps', () => {
    const serialized = serializePackageMetrics(metrics)
    expect(serialized).not.toMatch(/generatedAt|timestamp|\/home\/|\/media\/|[A-Za-z]:\\\\/u)
    expect(metrics.package.name).toBe('purejsimage')
    expect(metrics.targets).toHaveLength(pureTargets.length + competitorTargets.length)
    expect(metrics.targets.every(({ packageVersions }) => packageVersions.length > 0)).toBe(true)
    expect(metrics.targets.every(({ unpackedPackageBytes }) => unpackedPackageBytes > 0)).toBe(true)
    expect(serialized).not.toContain('installedPackageFootprintBytes')
    expect(metrics.wasmAssets).toHaveLength(6)
    expect(
      metrics.wasmAssets.every(
        ({ rawBytes, gzipBytes, brotliBytes }) => rawBytes > 0 && gzipBytes > 0 && brotliBytes > 0,
      ),
    ).toBe(true)
  })

  it('keeps the checked-in copies and README generated regions synchronized', () => {
    const expected = serializePackageMetrics(metrics)
    for (const path of [packageMetricsPath, 'docs-astro/src/data/package-metrics.json']) {
      expect(
        serializePackageMetrics(parsePackageMetrics(JSON.parse(readFileSync(path, 'utf8')))),
      ).toBe(expected)
    }

    const readme = readFileSync('README.md', 'utf8')
    for (const id of ['scientific-readers', 'bundle']) {
      expect(readme).toContain(`<!-- package-metrics:${id}:start -->`)
      expect(readme).toContain(`<!-- package-metrics:${id}:end -->`)
    }
    expect(readme).toContain(`**${metrics.scientificReaders.length} scientific readers**`)
    expect(readme).toContain('six optional JPEG and PNG accelerator assets')
    expect(readme).toContain('Complete size and footprint tables')
    expect(packageJson.scripts['package-metrics:check']).toBe(
      'node scripts/render-package-metrics.ts --check',
    )
  })
})
