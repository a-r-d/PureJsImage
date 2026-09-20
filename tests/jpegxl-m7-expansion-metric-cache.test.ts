import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { reuseM7ExpansionMetrics } from '../benchmark/jpegxl/m7-expansion-metric-cache.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'm7-expansion-metrics-'))
  directories.push(directory)
  const protocol: Record<string, unknown> = {
    cases: [{ id: 'source', sourceSha256: 'a'.repeat(64) }],
    mappingProtocolSha256: 'c'.repeat(64),
    mappingHash: 'd'.repeat(64),
    oracleFiles: [{ path: 'metric', sha256: 'e'.repeat(64) }],
    sharpVersions: { vips: 'pinned' },
  }
  const display = {
    background: 'black',
    decodedSha256: 'b'.repeat(64),
    ssimulacra2: 90,
    butteraugli: 1.2,
    ssimulacra2Text: '90\n',
    butteraugliText: '1.2\n',
  }
  const point = { engine: 'purejsimage', setting: 1, status: 'measured', composites: [display] }
  const report = { id: 'source', sourceSha256: 'a'.repeat(64), points: [point] }
  const reportPath = join(directory, 'report.json'),
    protocolPath = join(directory, 'protocol.json')
  const save = async () => {
    await writeFile(reportPath, JSON.stringify(report))
    await writeFile(protocolPath, JSON.stringify(protocol))
  }
  await save()
  return {
    protocol,
    display,
    point,
    report,
    save,
    options: {
      reportPath,
      protocolPath,
      protocol,
      kind: 'alpha' as const,
      id: 'source',
      sourceSha256: 'a'.repeat(64),
      engine: 'purejsimage',
      setting: 1,
      domain: 'black',
      decodedSha256: 'b'.repeat(64),
    },
  }
}

test('reuses metrics only for the identical freshly decoded display and frozen reference contract', async () => {
  const { options } = await fixture()
  const result = await reuseM7ExpansionMetrics(options)
  expect(result).toMatchObject({ ssimulacra2: 90, butteraugli: 1.2 })
  expect(result?.metricReuse.reportSha256).toMatch(/^[a-f0-9]{64}$/u)
})

test('requires fresh measurement for changed pixels, missing domains and failed prior points', async () => {
  const { options, point, save } = await fixture()
  expect(
    await reuseM7ExpansionMetrics({ ...options, decodedSha256: 'f'.repeat(64) }),
  ).toBeUndefined()
  expect(await reuseM7ExpansionMetrics({ ...options, domain: 'white' })).toBeUndefined()
  point.status = 'failed'
  await save()
  expect(await reuseM7ExpansionMetrics(options)).toBeUndefined()
})

test.each([
  'mappingProtocolSha256',
  'mappingHash',
  'oracleFiles',
  'sharpVersions',
  'cases',
  'split',
])('rejects changed reference or metric provenance: %s', async (field) => {
  const { options, protocol } = await fixture()
  await expect(
    reuseM7ExpansionMetrics({ ...options, protocol: { ...protocol, [field]: 'changed' } }),
  ).rejects.toThrow('mismatch')
})

test('rejects altered raw scores and duplicate coordinates', async () => {
  const { options, display, report, point, save } = await fixture()
  display.ssimulacra2Text = '89'
  await save()
  await expect(reuseM7ExpansionMetrics(options)).rejects.toThrow('Invalid cached expansion metric')
  report.points.push(point)
  await save()
  await expect(reuseM7ExpansionMetrics(options)).rejects.toThrow('Duplicate')
})

test('validates HDR input, reference and display-mapping fingerprints independently of encoder changes', async () => {
  const { options } = await fixture()
  const mapping = { path: 'benchmark/jpegxl/m7-hdr-mapping.ts', sha256: 'c'.repeat(64) }
  const protocol: Record<string, unknown> = {
    id: 'source',
    distance: 1,
    width: 1,
    height: 1,
    effort: 7,
    split: 'development',
    sourceSha256: options.sourceSha256,
    inputSha256: 'd'.repeat(64),
    referenceSha256: 'e'.repeat(64),
    mappingProtocolSha256: 'f'.repeat(64),
    oracleFiles: [{ path: 'metric', sha256: 'a'.repeat(64) }],
    sourceFiles: [mapping, { path: 'encoder.ts', sha256: 'old' }],
  }
  const report = {
    protocol,
    results: [
      {
        engine: 'purejsimage',
        status: 'measured',
        displays: [
          {
            headroom: 1,
            decodedSha256: options.decodedSha256,
            ssimulacra2: 90,
            butteraugli: 1.2,
            ssimulacra2Text: '90',
            butteraugliText: '1.2',
          },
        ],
      },
    ],
  }
  await writeFile(options.reportPath, JSON.stringify(report))
  const current = { ...protocol, sourceFiles: [mapping, { path: 'encoder.ts', sha256: 'new' }] }
  const { protocolPath: _protocolPath, ...common } = options
  expect(
    await reuseM7ExpansionMetrics({ ...common, kind: 'hdr', domain: 1, protocol: current }),
  ).toMatchObject({ ssimulacra2: 90 })
  await expect(
    reuseM7ExpansionMetrics({
      ...common,
      kind: 'hdr',
      domain: 1,
      protocol: {
        ...current,
        sourceFiles: [{ ...mapping, sha256: 'changed' }],
      },
    }),
  ).rejects.toThrow('mapping mismatch')
  await expect(
    reuseM7ExpansionMetrics({
      ...common,
      kind: 'hdr',
      domain: 1,
      protocol: {
        ...current,
        referenceSha256: 'changed',
      },
    }),
  ).rejects.toThrow('referenceSha256')
})
