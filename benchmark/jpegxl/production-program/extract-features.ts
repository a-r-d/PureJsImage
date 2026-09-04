import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
} from '../../../src/codecs/jpegxl-container.ts'
import {
  decodeJpegXlModularDcFrameSection,
  type JpegXlFrameStructure,
  readJpegXlSourceFrameStructures,
} from '../../../src/codecs/jpegxl-decode.ts'
import { resolveJpegXlLimits } from '../../../src/codecs/jpegxl-limits.ts'
import {
  decodeJpegXlJpegDcGroup,
  decodeJpegXlJpegLfGlobal,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { inspectJpegXl } from '../../../src/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { type ImageSource, MemorySource, readExactly } from '../../../src/source.ts'

interface FixtureSource {
  readonly id: string
  readonly path: string
  readonly source: string
  readonly license: string
  readonly checksum: string
  readonly encoder: string
  readonly encoderRevision: string
  readonly options: readonly string[]
  readonly expectedResult: string
  readonly oracleResult: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const texts = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return Object.freeze(value.map(String))
}

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))

const fixturesFromGeneratedManifest = async (
  manifestPath: string,
  directory: string,
  encoder: string,
): Promise<readonly FixtureSource[]> => {
  const manifest = record(await readJson(manifestPath), manifestPath)
  const revision = text(manifest.revision, `${manifestPath}.revision`)
  return Object.freeze(
    array(manifest.fixtures, `${manifestPath}.fixtures`).map((item, index) => {
      const fixture = record(item, `${manifestPath}.fixtures[${index}]`)
      const id = text(fixture.id, `${manifestPath}.fixtures[${index}].id`)
      const oracleHash =
        typeof fixture.djxlOutputSha256 === 'string'
          ? fixture.djxlOutputSha256
          : typeof fixture.oracleSha256 === 'string'
            ? fixture.oracleSha256
            : 'recorded in the component manifest'
      return Object.freeze({
        id,
        path: join(directory, `${id}.jxl`),
        source: text(fixture.source, `${manifestPath}.fixtures[${index}].source`),
        license: text(fixture.license, `${manifestPath}.fixtures[${index}].license`),
        checksum: text(fixture.jxlSha256, `${manifestPath}.fixtures[${index}].jxlSha256`),
        encoder,
        encoderRevision: revision,
        options: texts(fixture.options, `${manifestPath}.fixtures[${index}].options`),
        expectedResult: text(
          fixture.expectedPureJsImageBehavior,
          `${manifestPath}.fixtures[${index}].expectedPureJsImageBehavior`,
        ),
        oracleResult: `SHA-256 ${oracleHash}`,
      })
    }),
  )
}

const conformanceFixtures = async (): Promise<readonly FixtureSource[]> => {
  const path = join('benchmark', 'jpegxl', 'production-program', 'corpora', 'conformance.json')
  const manifest = record(await readJson(path), path)
  const revision = text(manifest.revision, `${path}.revision`)
  const wanted = new Set(['alpha_nonpremultiplied', 'alpha_triangles'])
  return Object.freeze(
    array(manifest.cases, `${path}.cases`)
      .map((item, index) => record(item, `${path}.cases[${index}]`))
      .filter((item) => wanted.has(text(item.id, 'conformance case id')))
      .map((item) => {
        const id = text(item.id, 'conformance case id')
        return Object.freeze({
          id: `conformance-${id.replaceAll('_', '-')}`,
          path: join(
            'benchmark',
            'fixtures',
            'jpegxl',
            `conformance-${id.replaceAll('_', '-')}.jxl`,
          ),
          source: `https://github.com/libjxl/conformance/tree/${revision}/testcases/${id}`,
          license: text(item.license, `${id}.license`),
          checksum: text(item.sha256, `${id}.sha256`),
          encoder: 'libjxl conformance corpus',
          encoderRevision: revision,
          options: Object.freeze(['upstream conformance generator options']),
          expectedResult: 'exact-decode',
          oracleResult: `native sample SHA-256 ${text(item.outputSha256, `${id}.outputSha256`)}`,
        })
      }),
  )
}

const reconstructionFixtures = async (): Promise<readonly FixtureSource[]> => {
  const path = join('benchmark', 'jpegxl', 'jpeg-reconstruction-manifest.json')
  const manifest = record(await readJson(path), path)
  const revision = text(manifest.revision, `${path}.revision`)
  return Object.freeze(
    array(manifest.fixtures, `${path}.fixtures`).map((item, index) => {
      const fixture = record(item, `${path}.fixtures[${index}]`)
      const id = text(fixture.id, `${path}.fixtures[${index}].id`)
      return Object.freeze({
        id,
        path: text(fixture.jxl, `${id}.jxl`),
        source: text(fixture.source, `${id}.source`),
        license: 'BSD-3-Clause Web Platform Tests fixture',
        checksum: text(fixture.jxlSha256, `${id}.jxlSha256`),
        encoder: 'libjxl cjxl 0.12.0 exact JPEG recompression',
        encoderRevision: revision,
        options: Object.freeze(['--lossless_jpeg=1', '--compress_boxes=0', '--effort=1']),
        expectedResult: 'pixel decode and exact JPEG reconstruction',
        oracleResult: `JPEG SHA-256 ${text(fixture.reconstructedJpegSha256, `${id}.reconstructedJpegSha256`)}`,
      })
    }),
  )
}

const uniqueStrategies = (frame: Readonly<JpegXlFrameStructure>, values: Uint8Array): number[] => {
  const found = new Set<number>()
  for (let index = 0; index < values.length; index += 1) {
    const blockX = index % Math.ceil(frame.width / 8)
    const blockY = Math.floor(index / Math.ceil(frame.width / 8))
    if (blockX * 8 < frame.width && blockY * 8 < frame.height) found.add(values[index] ?? 255)
  }
  found.delete(255)
  return [...found].sort((left, right) => left - right)
}

const extractStrategyIds = async (
  logical: ImageSource,
  frames: readonly JpegXlFrameStructure[],
): Promise<readonly number[]> => {
  const frame = frames.at(-1)
  if (frame?.encoding !== 'vardct') return Object.freeze([])
  const blockWidth = Math.ceil(frame.width / 8)
  const blockHeight = Math.ceil(frame.height / 8)
  if (frame.sections.length === 1) {
    const section = frame.sections[0]
    if (!section) throw new Error('JPEG XL integrated VarDCT section is missing')
    const bytes = await readExactly(logical, section.offset, section.length)
    const lf = decodeJpegXlJpegLfGlobal(bytes, 0, false, frame.frameFlags)
    const dc = decodeJpegXlJpegDcGroup(
      bytes,
      {
        blockWidth,
        blockHeight,
        chromaSubsampling: frame.chromaSubsampling,
        groupId: 0,
        dcGroupCount: 1,
      },
      lf.globalModularCode,
      lf.endingBitPosition,
      false,
    )
    return Object.freeze(uniqueStrategies(frame, dc.strategies))
  }
  const lfSection = frame.sections[0]
  if (!lfSection) throw new Error('JPEG XL separated VarDCT LF section is missing')
  const lfBytes = await readExactly(logical, lfSection.offset, lfSection.length)
  const lf = decodeJpegXlJpegLfGlobal(lfBytes, 0, true, frame.frameFlags)
  let externalDcPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
  const dcFrame = frames.length === 2 ? frames[0] : undefined
  if (dcFrame?.frameType === 'dc') {
    const section = dcFrame.sections[0]
    if (!section) throw new Error('JPEG XL external DC frame section is missing')
    const bytes = await readExactly(logical, section.offset, section.length)
    externalDcPlanes = decodeJpegXlModularDcFrameSection(bytes, blockWidth, blockHeight)
  }
  const strategyIds = new Set<number>()
  const dcGroupBlockDimension = frame.groupDimension
  const dcGroupsAcross = Math.ceil(blockWidth / dcGroupBlockDimension)
  for (let groupId = 0; groupId < frame.dcGroupCount; groupId += 1) {
    const dcSection = frame.sections[1 + groupId]
    if (!dcSection) throw new Error('JPEG XL separated VarDCT DC section is missing')
    const groupX = (groupId % dcGroupsAcross) * dcGroupBlockDimension
    const groupY = Math.floor(groupId / dcGroupsAcross) * dcGroupBlockDimension
    const groupWidth = Math.min(dcGroupBlockDimension, blockWidth - groupX)
    const groupHeight = Math.min(dcGroupBlockDimension, blockHeight - groupY)
    let externalGroupPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
    if (externalDcPlanes) {
      const slices = externalDcPlanes.map((plane) => {
        const output = new Float64Array(groupWidth * groupHeight)
        for (let y = 0; y < groupHeight; y += 1) {
          output.set(
            plane.subarray(
              (groupY + y) * blockWidth + groupX,
              (groupY + y) * blockWidth + groupX + groupWidth,
            ),
            y * groupWidth,
          )
        }
        return output
      })
      const first = slices[0]
      const second = slices[1]
      const third = slices[2]
      if (!first || !second || !third) throw new Error('JPEG XL external DC plane is missing')
      externalGroupPlanes = Object.freeze([first, second, third])
    }
    const dcBytes = await readExactly(logical, dcSection.offset, dcSection.length)
    const dc = decodeJpegXlJpegDcGroup(
      dcBytes,
      {
        blockWidth: groupWidth,
        blockHeight: groupHeight,
        chromaSubsampling: frame.chromaSubsampling,
        groupId,
        dcGroupCount: frame.dcGroupCount,
      },
      lf.globalModularCode,
      0,
      true,
      externalGroupPlanes,
    )
    const localFrame = { ...frame, width: groupWidth * 8, height: groupHeight * 8 }
    for (const strategy of uniqueStrategies(localFrame, dc.strategies)) {
      strategyIds.add(strategy)
    }
  }
  return Object.freeze([...strategyIds].sort((left, right) => left - right))
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const lossless = await fixturesFromGeneratedManifest(
  join('benchmark', 'jpegxl', 'generated-lossless-manifest.json'),
  join('benchmark', 'fixtures', 'jpegxl', 'generated-lossless-v0.12.0'),
  'libjxl cjxl 0.12.0',
)
const varDct = await fixturesFromGeneratedManifest(
  join('benchmark', 'jpegxl', 'generated-vardct-manifest.json'),
  join('benchmark', 'fixtures', 'jpegxl', 'generated-vardct-v0.12.0'),
  'libjxl cjxl 0.12.0',
)
const allSources = [
  ...(await conformanceFixtures()),
  ...lossless,
  ...varDct,
  ...(await reconstructionFixtures()),
]
const featureManifestPath = join(
  'benchmark',
  'jpegxl',
  'production-program',
  'corpora',
  'generated-features.json',
)
const featureManifest = record(await readJson(featureManifestPath), featureManifestPath)
const prCorpus = new Set(texts(featureManifest.prCorpus, `${featureManifestPath}.prCorpus`))
const sources = allSources.filter(({ id, path }) => prCorpus.has(id) && path.length > 0)
if (sources.length !== prCorpus.size) {
  const found = new Set(sources.map(({ id }) => id))
  throw new Error(
    `PR corpus sources are missing: ${[...prCorpus].filter((id) => !found.has(id)).join(', ')}`,
  )
}

const fixtures = []
for (const fixture of sources.sort((left, right) => left.id.localeCompare(right.id))) {
  const encoded = new Uint8Array(await readFile(fixture.path))
  if (sha256(encoded) !== fixture.checksum) throw new Error(`${fixture.id} checksum changed`)
  const physical = new MemorySource(encoded)
  const structure = await inspectJpegXlSource(physical, resolveJpegXlLimits())
  const logical = new JpegXlCodestreamSource(physical, structure)
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const frame = frames.at(-1)
  if (!frame) throw new Error(`${fixture.id} has no display frame`)
  const inspected = await inspectJpegXl(encoded)
  const strategyIds = await extractStrategyIds(logical, frames)
  const regularFrames = frames.filter(({ frameType }) => frameType === 'regular').length
  fixtures.push(
    Object.freeze({
      id: fixture.id,
      source: fixture.source,
      license: fixture.license,
      checksum: fixture.checksum,
      encoder: fixture.encoder,
      encoderRevision: fixture.encoderRevision,
      options: fixture.options,
      dimensions: Object.freeze({ width: frame.width, height: frame.height }),
      level: structure.level ?? 'unknown',
      encoding: frame.encoding,
      strategyIds,
      groupCount: frame.groupsAcross * frame.groupsDown,
      lfGroupCount: frame.dcGroupCount,
      passes: frame.passCount,
      chromaShifts: frame.chromaSubsampling,
      colorEncoding: frame.metadataColorSpace,
      bitDepth: frame.bitDepth,
      alpha: inspected.alpha,
      extraChannels: inspected.extraChannels,
      patches: (frame.frameFlags & 2) !== 0,
      patchCount: (frame.frameFlags & 2) === 0 ? 0 : null,
      splines: (frame.frameFlags & 16) !== 0,
      splineCount: (frame.frameFlags & 16) === 0 ? 0 : null,
      noise: (frame.frameFlags & 1) !== 0,
      restoration: Object.freeze({ gaborish: frame.gaborish, epfIterations: frame.epfIterations }),
      orientation: frame.orientation,
      preview: inspected.preview,
      animation: regularFrames > 1,
      internalFrames: frames.length - regularFrames,
      expectedResult: fixture.expectedResult,
      oracleResult: fixture.oracleResult,
    }),
  )
}

const report = Object.freeze({
  schemaVersion: 1,
  extraction:
    'PureJsImage container and codestream parsers; strategy IDs come from decoded AC strategy maps',
  fixtures: Object.freeze(fixtures),
})
const outputPath = join('benchmark', 'jpegxl', 'production-program', 'feature-inventory.json')
const serialized = `${JSON.stringify(report, null, 2)}\n`
if (process.argv.includes('--write')) await writeFile(outputPath, serialized)
else if (process.argv.includes('--check')) {
  const current: unknown = JSON.parse(await readFile(outputPath, 'utf8'))
  if (JSON.stringify(current) !== JSON.stringify(report)) {
    throw new Error(`${outputPath} is not current; run with --write`)
  }
} else process.stdout.write(serialized)
