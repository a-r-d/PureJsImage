import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { inspectHdrJpeg, inspectHdrJpegHeader } from '../../src/hdr/index.ts'
import { MemorySource } from '../../src/source.ts'

interface FixtureManifestEntry {
  readonly id: string
  readonly file: string
  readonly sha256: string
  readonly container: 'jpeg-mpf' | 'avif'
  readonly baseDimensions: readonly [number, number]
  readonly gainMapDimensions: readonly [number, number]
  readonly mapChannels: 1 | 3
  readonly metadataRepresentations: readonly string[]
  readonly expectedSourceRanges:
    | Readonly<{
        readonly base: readonly [number, number]
        readonly gainMap: readonly [number, number]
      }>
    | string
}

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is invalid`)
  return value
}

const dimensions = (value: unknown, label: string): readonly [number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((item) => Number.isSafeInteger(item) && Number(item) > 0)
  ) {
    throw new Error(`${label} is invalid`)
  }
  return [Number(value[0]), Number(value[1])]
}

const sourceRanges = (
  value: unknown,
  label: string,
): FixtureManifestEntry['expectedSourceRanges'] => {
  if (typeof value === 'string') return value
  if (!record(value)) throw new Error(`${label} is invalid`)
  const byteRange = (candidate: unknown, rangeLabel: string): readonly [number, number] => {
    if (
      !Array.isArray(candidate) ||
      candidate.length !== 2 ||
      !candidate.every((item) => Number.isSafeInteger(item)) ||
      Number(candidate[0]) < 0 ||
      Number(candidate[1]) <= Number(candidate[0])
    ) {
      throw new Error(`${rangeLabel} is invalid`)
    }
    return [Number(candidate[0]), Number(candidate[1])]
  }
  return Object.freeze({
    base: byteRange(value.base, `${label}.base`),
    gainMap: byteRange(value.gainMap, `${label}.gainMap`),
  })
}

const fixtureEntry = (value: unknown, index: number): FixtureManifestEntry => {
  if (!record(value)) throw new Error(`fixtures[${index}] is invalid`)
  const container = stringValue(value.container, `fixtures[${index}].container`)
  if (container !== 'jpeg-mpf' && container !== 'avif') {
    throw new Error(`fixtures[${index}].container is unsupported`)
  }
  if (value.mapChannels !== 1 && value.mapChannels !== 3) {
    throw new Error(`fixtures[${index}].mapChannels is invalid`)
  }
  if (
    !Array.isArray(value.metadataRepresentations) ||
    !value.metadataRepresentations.every((item) => typeof item === 'string')
  ) {
    throw new Error(`fixtures[${index}].metadataRepresentations is invalid`)
  }
  return Object.freeze({
    id: stringValue(value.id, `fixtures[${index}].id`),
    file: stringValue(value.file, `fixtures[${index}].file`),
    sha256: stringValue(value.sha256, `fixtures[${index}].sha256`),
    container,
    baseDimensions: dimensions(value.baseDimensions, `fixtures[${index}].baseDimensions`),
    gainMapDimensions: dimensions(value.gainMapDimensions, `fixtures[${index}].gainMapDimensions`),
    mapChannels: value.mapChannels,
    metadataRepresentations: Object.freeze([...value.metadataRepresentations]),
    expectedSourceRanges: sourceRanges(
      value.expectedSourceRanges,
      `fixtures[${index}].expectedSourceRanges`,
    ),
  })
}

const manifestBytes = await readFile('benchmark/hdr-surgery/fixture-manifest.json')
const manifestValue: unknown = JSON.parse(manifestBytes.toString('utf8'))
if (
  !record(manifestValue) ||
  manifestValue.version !== 1 ||
  !Array.isArray(manifestValue.fixtures)
) {
  throw new Error('HDR Surgery fixture manifest is invalid')
}

const seenIds = new Set<string>()
for (const [index, rawFixture] of manifestValue.fixtures.entries()) {
  const fixture = fixtureEntry(rawFixture, index)
  if (seenIds.has(fixture.id)) throw new Error(`duplicate fixture id ${fixture.id}`)
  seenIds.add(fixture.id)
  const bytes = new Uint8Array(await readFile(fixture.file))
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== fixture.sha256) throw new Error(`${fixture.id}: checksum changed`)

  if (fixture.container === 'jpeg-mpf') {
    const inspection = await inspectHdrJpeg(new MemorySource(bytes))
    const isAppleLegacy = fixture.metadataRepresentations[0] === 'apple-hdrgainmap-xmp'
    const legacyRange = isAppleLegacy ? inspection.mpf?.images[1]?.range : undefined
    const legacyHeader = legacyRange
      ? await inspectHdrJpegHeader(new MemorySource(bytes), legacyRange.start)
      : undefined
    if (
      inspection.primaryDimensions.width !== fixture.baseDimensions[0] ||
      inspection.primaryDimensions.height !== fixture.baseDimensions[1] ||
      (isAppleLegacy
        ? legacyHeader?.dimensions.width !== fixture.gainMapDimensions[0] ||
          legacyHeader.dimensions.height !== fixture.gainMapDimensions[1] ||
          legacyHeader.dimensions.components !== fixture.mapChannels
        : inspection.gainMapDimensions?.width !== fixture.gainMapDimensions[0] ||
          inspection.gainMapDimensions.height !== fixture.gainMapDimensions[1] ||
          inspection.gainMapDimensions.components !== fixture.mapChannels)
    ) {
      throw new Error(`${fixture.id}: JPEG dimensions or channels changed`)
    }
    const inspectedGainMap = isAppleLegacy ? legacyRange : inspection.gainMap
    if (typeof fixture.expectedSourceRanges === 'string' || !inspectedGainMap) {
      throw new Error(`${fixture.id}: expected JPEG source ranges are missing`)
    }
    const expectedBase = fixture.expectedSourceRanges.base
    const expectedMap = fixture.expectedSourceRanges.gainMap
    if (
      inspection.primary.start !== expectedBase[0] ||
      inspection.primary.end !== expectedBase[1] ||
      inspectedGainMap.start !== expectedMap[0] ||
      inspectedGainMap.end !== expectedMap[1]
    ) {
      throw new Error(`${fixture.id}: JPEG source ranges changed`)
    }
    if (
      !isAppleLegacy &&
      JSON.stringify(inspection.representations) !== JSON.stringify(fixture.metadataRepresentations)
    ) {
      throw new Error(`${fixture.id}: JPEG metadata representations changed`)
    }
  }
  console.log(`ok ${fixture.id} ${bytes.byteLength} bytes ${digest}`)
}
