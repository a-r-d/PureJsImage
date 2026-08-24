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
  applyRecordedNativeWrapperFootprints,
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
    expect(metrics.package.unpackedPackageBytes).toBeGreaterThan(0)
    expect(metrics.package.productionPackageCount).toBe(1)
    expect(metrics.schemaVersion).toBe(3)
    expect(metrics.targets).toHaveLength(pureTargets.length + competitorTargets.length)
    expect(metrics.targets.every(({ packageVersions }) => packageVersions.length > 0)).toBe(true)
    expect(metrics.targets.every(({ unpackedPackageBytes }) => unpackedPackageBytes > 0)).toBe(true)
    expect(serialized).not.toContain('installedPackageFootprintBytes')
    expect(metrics.wasmAssets).toHaveLength(8)
    expect(
      metrics.wasmAssets.every(
        ({ rawBytes, gzipBytes, brotliBytes }) => rawBytes > 0 && gzipBytes > 0 && brotliBytes > 0,
      ),
    ).toBe(true)
  })

  it('keeps native wrapper footprints platform-specific without hiding bundle changes', () => {
    const nativeTarget = metrics.targets.find(
      ({ implementation }) => implementation === 'native-wrapper',
    )
    expect(nativeTarget).toBeDefined()
    if (nativeTarget === undefined) return
    const measured = {
      ...metrics,
      targets: metrics.targets.map((target) =>
        target.id === nativeTarget.id
          ? {
              ...target,
              minifiedJsBytes: target.minifiedJsBytes + 1,
              unpackedPackageBytes: target.unpackedPackageBytes + 2,
              packageVersions: [{ name: '@img/platform-package', version: '1.0.0' }],
              productionPackageCount: target.productionPackageCount + 3,
            }
          : target,
      ),
    }
    const comparable = applyRecordedNativeWrapperFootprints(measured, metrics)
    const comparableTarget = comparable.targets.find(({ id }) => id === nativeTarget.id)
    expect(comparableTarget).toMatchObject({
      minifiedJsBytes: nativeTarget.minifiedJsBytes + 1,
      unpackedPackageBytes: nativeTarget.unpackedPackageBytes,
      packageVersions: nativeTarget.packageVersions,
      productionPackageCount: nativeTarget.productionPackageCount,
    })
  })

  it('reads a v2 metrics document even when a competitor target is listed first', () => {
    const parsed = parsePackageMetrics({
      schemaVersion: 2,
      package: { name: 'purejsimage', version: '0.10.0' },
      liveDemoReaderIds: [],
      codecs: [],
      scientificReaders: [],
      scientificReaderGroups: [],
      wasmAssets: [],
      targets: [
        {
          category: 'competitor',
          configuredCeilingMinifiedBytes: null,
          entry: { packageExports: ['jimp'] },
          gzipBytes: 1,
          id: 'jimp',
          implementation: 'pure-javascript',
          unpackedPackageBytes: 99_000,
          minifiedJsBytes: 10,
          name: 'Jimp',
          packageVersions: [{ name: 'jimp', version: '1.0.0' }],
          productionPackageCount: 70,
          recordedBaselineMinifiedBytes: null,
          brotliBytes: 1,
        },
        {
          category: 'purejsimage-entry',
          configuredCeilingMinifiedBytes: null,
          entry: { packageExports: ['purejsimage'] },
          gzipBytes: 2,
          id: 'core',
          implementation: 'package-core',
          unpackedPackageBytes: 4_000,
          minifiedJsBytes: 20,
          name: 'Core API',
          packageVersions: [{ name: 'purejsimage', version: '0.10.0' }],
          productionPackageCount: 1,
          recordedBaselineMinifiedBytes: null,
          brotliBytes: 2,
        },
      ],
    })
    expect(parsed.package.unpackedPackageBytes).toBe(4_000)
    expect(parsed.package.productionPackageCount).toBe(1)
    expect(parsed.targets[0]?.unpackedPackageBytes).toBe(99_000)
    expect(parsed.targets[1]?.unpackedPackageBytes).toBe(4_000)
    expect(() =>
      parsePackageMetrics({
        schemaVersion: 2,
        package: { name: 'purejsimage', version: '0.10.0' },
        liveDemoReaderIds: [],
        codecs: [],
        scientificReaders: [],
        scientificReaderGroups: [],
        wasmAssets: [],
        targets: [
          {
            category: 'purejsimage-entry',
            configuredCeilingMinifiedBytes: null,
            entry: { packageExports: ['purejsimage'] },
            gzipBytes: 2,
            id: 'core',
            implementation: 'package-core',
            unpackedPackageBytes: 4_000,
            minifiedJsBytes: 20,
            name: 'Core API',
            packageVersions: [{ name: 'purejsimage', version: '9.9.9' }],
            productionPackageCount: 1,
            recordedBaselineMinifiedBytes: null,
            brotliBytes: 2,
          },
        ],
      }),
    ).toThrow(/packageVersions must match package.name and package.version/u)
  })

  it('stores the host package footprint once instead of copying it onto every entry', () => {
    const serialized = JSON.parse(serializePackageMetrics(metrics)) as {
      readonly package: { readonly unpackedPackageBytes: number }
      readonly targets: readonly Record<string, unknown>[]
    }
    expect(serialized.package.unpackedPackageBytes).toBe(metrics.package.unpackedPackageBytes)
    const hostTargets = serialized.targets.filter(
      (target) => target.unpackedPackageBytes === undefined && target.packageVersions === undefined,
    )
    const foreignTargets = serialized.targets.filter(
      (target) => target.unpackedPackageBytes !== undefined,
    )
    expect(hostTargets.length).toBeGreaterThan(50)
    expect(foreignTargets.length).toBeGreaterThan(0)
    expect(
      foreignTargets.every(
        (target) => target.unpackedPackageBytes !== serialized.package.unpackedPackageBytes,
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
    expect(readme).toContain('eight optional JPEG, PNG, and WebP accelerator assets')
    expect(readme).toContain('Complete size and footprint tables')
    expect(packageJson.scripts['package-metrics:check']).toBe(
      'node scripts/render-package-metrics.ts --check',
    )
  })
})
