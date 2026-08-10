import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface UnsupportedRecord {
  readonly relativeFilename: string
  readonly actualOutcome: string
}

interface ParsedReport {
  readonly records: readonly UnsupportedRecord[]
}

interface Field {
  readonly type: number
  readonly count: number
  readonly valueOffset: number
  readonly inlineOffset: number
  readonly inlineBytes: number
}

export interface TiffTags {
  readonly file: string
  readonly byteOrder: 'II' | 'MM'
  readonly bigTiff: boolean
  readonly width: readonly number[]
  readonly height: readonly number[]
  readonly bitsPerSample: readonly number[]
  readonly sampleFormat: readonly number[]
  readonly samplesPerPixel: readonly number[]
  readonly extraSamples: readonly number[]
  readonly photometric: readonly number[]
  readonly compression: readonly number[]
  readonly predictor: readonly number[]
  readonly planarConfiguration: readonly number[]
  readonly fillOrder: readonly number[]
  readonly rowsPerStrip: readonly number[]
  readonly stripOffsets: number
  readonly tileWidth: readonly number[]
  readonly tileLength: readonly number[]
  readonly tileOffsets: number
  readonly subIfds: number
  readonly hasIccProfile: boolean
  readonly iccProfileBytes: number
  readonly sMinSampleValue: readonly number[]
  readonly sMaxSampleValue: readonly number[]
  readonly jpegTablesBytes: number
  readonly dependencies: readonly string[]
}

const fieldWidths: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
  16: 8,
  17: 8,
  18: 8,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseReport = (value: unknown): ParsedReport => {
  if (!isRecord(value) || !Array.isArray(value.records)) {
    throw new Error('Imazen report has no records array')
  }
  const records = value.records.map((record: unknown): UnsupportedRecord => {
    if (
      !isRecord(record) ||
      typeof record.relativeFilename !== 'string' ||
      typeof record.actualOutcome !== 'string'
    ) {
      throw new Error('Imazen report contains an invalid record')
    }
    return {
      relativeFilename: record.relativeFilename,
      actualOutcome: record.actualOutcome,
    }
  })
  return { records }
}

const safeNumber = (value: bigint, label: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${label} exceeds safe integer range`)
  return Number(value)
}

class TiffReader {
  readonly #bytes: Uint8Array
  readonly #view: DataView
  readonly littleEndian: boolean
  readonly bigTiff: boolean
  readonly inlineBytes: number
  readonly entries: ReadonlyMap<number, Field>

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.byteLength < 8) throw new Error('TIFF header is truncated')
    const first = bytes[0]
    const second = bytes[1]
    if (first === 0x49 && second === 0x49) this.littleEndian = true
    else if (first === 0x4d && second === 0x4d) this.littleEndian = false
    else throw new Error('TIFF byte order is invalid')
    const version = this.uint16(2)
    if (version !== 42 && version !== 43) throw new Error(`TIFF version ${version} is unsupported`)
    this.bigTiff = version === 43
    this.inlineBytes = this.bigTiff ? 8 : 4
    if (this.bigTiff) {
      if (bytes.byteLength < 16 || this.uint16(4) !== 8 || this.uint16(6) !== 0) {
        throw new Error('BigTIFF header is invalid')
      }
    }
    const firstIfd = this.bigTiff ? this.uint64(8, 'first IFD') : this.uint32(4)
    this.entries = this.readIfd(firstIfd)
  }

  private extent(offset: number, length: number, label: string): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > this.#bytes.byteLength
    ) {
      throw new Error(`${label} exceeds TIFF input`)
    }
  }

  private uint16(offset: number): number {
    this.extent(offset, 2, 'uint16')
    return this.#view.getUint16(offset, this.littleEndian)
  }

  private uint32(offset: number): number {
    this.extent(offset, 4, 'uint32')
    return this.#view.getUint32(offset, this.littleEndian)
  }

  private uint64(offset: number, label: string): number {
    this.extent(offset, 8, label)
    return safeNumber(this.#view.getBigUint64(offset, this.littleEndian), label)
  }

  private readIfd(offset: number): ReadonlyMap<number, Field> {
    const countBytes = this.bigTiff ? 8 : 2
    const entryBytes = this.bigTiff ? 20 : 12
    const count = this.bigTiff ? this.uint64(offset, 'IFD entry count') : this.uint16(offset)
    const entriesBytes = count * entryBytes
    if (!Number.isSafeInteger(entriesBytes)) throw new Error('IFD byte size overflows')
    this.extent(offset + countBytes, entriesBytes, 'IFD entries')
    const entries = new Map<number, Field>()
    for (let index = 0; index < count; index += 1) {
      const entry = offset + countBytes + index * entryBytes
      const tag = this.uint16(entry)
      const type = this.uint16(entry + 2)
      const fieldCount = this.bigTiff
        ? this.uint64(entry + 4, `tag ${tag} count`)
        : this.uint32(entry + 4)
      const inlineOffset = entry + (this.bigTiff ? 12 : 8)
      const width = fieldWidths[type]
      if (width === undefined) continue
      const bytes = fieldCount * width
      if (!Number.isSafeInteger(bytes)) throw new Error(`tag ${tag} byte size overflows`)
      const valueOffset =
        bytes <= this.inlineBytes
          ? inlineOffset
          : this.bigTiff
            ? this.uint64(inlineOffset, `tag ${tag} offset`)
            : this.uint32(inlineOffset)
      this.extent(valueOffset, bytes, `tag ${tag}`)
      entries.set(tag, {
        type,
        count: fieldCount,
        valueOffset,
        inlineOffset,
        inlineBytes: this.inlineBytes,
      })
    }
    return entries
  }

  count(tag: number): number {
    return this.entries.get(tag)?.count ?? 0
  }

  byteLength(tag: number): number {
    const field = this.entries.get(tag)
    if (!field) return 0
    const width = fieldWidths[field.type]
    return width === undefined ? 0 : field.count * width
  }

  values(tag: number, maximum = 32): readonly number[] {
    const field = this.entries.get(tag)
    if (!field) return []
    const width = fieldWidths[field.type]
    if (width === undefined) return []
    const count = Math.min(field.count, maximum)
    const values: number[] = []
    for (let index = 0; index < count; index += 1) {
      const offset = field.valueOffset + index * width
      switch (field.type) {
        case 1:
        case 2:
        case 7:
          values.push(this.#view.getUint8(offset))
          break
        case 3:
          values.push(this.#view.getUint16(offset, this.littleEndian))
          break
        case 4:
        case 13:
          values.push(this.#view.getUint32(offset, this.littleEndian))
          break
        case 5: {
          const numerator = this.#view.getUint32(offset, this.littleEndian)
          const denominator = this.#view.getUint32(offset + 4, this.littleEndian)
          values.push(denominator === 0 ? Number.NaN : numerator / denominator)
          break
        }
        case 6:
          values.push(this.#view.getInt8(offset))
          break
        case 8:
          values.push(this.#view.getInt16(offset, this.littleEndian))
          break
        case 9:
          values.push(this.#view.getInt32(offset, this.littleEndian))
          break
        case 10: {
          const numerator = this.#view.getInt32(offset, this.littleEndian)
          const denominator = this.#view.getInt32(offset + 4, this.littleEndian)
          values.push(denominator === 0 ? Number.NaN : numerator / denominator)
          break
        }
        case 11:
          values.push(this.#view.getFloat32(offset, this.littleEndian))
          break
        case 12:
          values.push(this.#view.getFloat64(offset, this.littleEndian))
          break
        case 16:
        case 18:
          values.push(safeNumber(this.#view.getBigUint64(offset, this.littleEndian), `tag ${tag}`))
          break
        case 17: {
          const value = this.#view.getBigInt64(offset, this.littleEndian)
          if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
            values.push(Number(value < 0n ? -Infinity : Infinity))
          } else values.push(Number(value))
          break
        }
      }
    }
    return values
  }
}

const first = (values: readonly number[], fallback: number): number => values[0] ?? fallback

const dependenciesFor = (reader: TiffReader): readonly string[] => {
  const dependencies = new Set<string>()
  const samplesPerPixel = first(reader.values(277), 1)
  const bits = reader.values(258).length === 0 ? [1] : [...reader.values(258)]
  const sampleFormats = reader.values(339).length === 0 ? [1] : [...reader.values(339)]
  const photometric = first(reader.values(262), -1)
  const compression = first(reader.values(259), 1)
  const predictor = first(reader.values(317), 1)
  const planar = first(reader.values(284), 1)
  const fillOrder = first(reader.values(266), 1)
  const extraSamples = reader.values(338)
  const baseSamples =
    photometric === 2 || photometric === 6 || photometric === 32845 ? 3 : photometric === 5 ? 4 : 1
  const uniformBits = bits.every((value) => value === bits[0])
  const baseBits = bits[0] ?? 1

  if (sampleFormats.some((value) => value !== 1)) {
    dependencies.add(`sample-format:${sampleFormats.join(',')}`)
  }
  if (![0, 1, 2, 3, 5, 6].includes(photometric)) dependencies.add(`photometric:${photometric}`)
  if (![1, 2, 3, 4, 5, 6, 7, 8, 32946, 32773].includes(compression)) {
    dependencies.add(`compression:${compression}`)
  }
  if (samplesPerPixel < baseSamples || samplesPerPixel > baseSamples + 1) {
    dependencies.add(`samples-per-pixel:${samplesPerPixel}`)
  }
  if (photometric === 5 && samplesPerPixel === 5) dependencies.add('cmyk-alpha')
  if (samplesPerPixel === 5 && photometric !== 5) dependencies.add('generic-five-band')
  if (extraSamples.length > 1 || extraSamples.some((value) => ![0, 1, 2].includes(value))) {
    dependencies.add(`extra-samples:${extraSamples.join(',')}`)
  }
  if (photometric === 2 || photometric === 5) {
    if (!uniformBits || (baseBits !== 8 && baseBits !== 16)) {
      dependencies.add(`color-depth:${bits.join(',')}`)
    }
  } else if (photometric === 6) {
    if (bits.some((value) => value !== 8)) dependencies.add(`ycbcr-depth:${bits.join(',')}`)
  } else if (![1, 2, 4, 8, 16].includes(baseBits)) {
    dependencies.add(`grayscale-depth:${baseBits}`)
  }
  if (samplesPerPixel === baseSamples + 1) {
    const alphaBits = bits[baseSamples] ?? baseBits
    if (alphaBits !== 8 && alphaBits !== 16) dependencies.add(`alpha-depth:${alphaBits}`)
  }
  if (predictor !== 1 && predictor !== 2) dependencies.add(`predictor:${predictor}`)
  if (predictor === 2 && (!uniformBits || (baseBits !== 8 && baseBits !== 16))) {
    dependencies.add(`predictor-2-depth:${bits.join(',')}`)
  }
  if (planar !== 1 && planar !== 2) dependencies.add(`planar-configuration:${planar}`)
  if (fillOrder !== 1 && ![2, 3, 4].includes(compression))
    dependencies.add(`fill-order:${fillOrder}`)
  if (reader.count(330) > 0) dependencies.add('subifd')
  if (reader.count(34675) > 0 && ![2, 3].includes(photometric) && ![6, 7].includes(compression)) {
    dependencies.add('icc-color-conversion')
  }
  if (sampleFormats.some((value) => value !== 1) && reader.count(340) === 0) {
    dependencies.add('display-range-unspecified')
  }
  return [...dependencies].sort()
}

export const inspectTiffDependencies = (bytes: Uint8Array, relativeFilename: string): TiffTags => {
  const reader = new TiffReader(bytes)
  return {
    file: relativeFilename,
    byteOrder: reader.littleEndian ? 'II' : 'MM',
    bigTiff: reader.bigTiff,
    width: reader.values(256),
    height: reader.values(257),
    bitsPerSample: reader.values(258),
    sampleFormat: reader.values(339),
    samplesPerPixel: reader.values(277),
    extraSamples: reader.values(338),
    photometric: reader.values(262),
    compression: reader.values(259),
    predictor: reader.values(317),
    planarConfiguration: reader.values(284),
    fillOrder: reader.values(266),
    rowsPerStrip: reader.values(278),
    stripOffsets: reader.count(273),
    tileWidth: reader.values(322),
    tileLength: reader.values(323),
    tileOffsets: reader.count(324),
    subIfds: reader.count(330),
    hasIccProfile: reader.count(34675) > 0,
    iccProfileBytes: reader.byteLength(34675),
    sMinSampleValue: reader.values(340),
    sMaxSampleValue: reader.values(341),
    jpegTablesBytes: reader.byteLength(347),
    dependencies: dependenciesFor(reader),
  }
}

const inspect = async (corpusRoot: string, relativeFilename: string): Promise<TiffTags> =>
  inspectTiffDependencies(await readFile(join(corpusRoot, relativeFilename)), relativeFilename)

const argument = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const markdownValues = (values: readonly number[]): string =>
  values.length === 0 ? '-' : values.map((value) => String(value)).join(',')
const waveDefinitions = [
  {
    id: 'A',
    capability: 'Unsigned 10/12/14-bit grayscale and RGB',
    dependencies: [
      'color-depth:10,10,10',
      'color-depth:12,12,12',
      'color-depth:14,14,14',
      'grayscale-depth:10',
      'grayscale-depth:12',
      'grayscale-depth:14',
    ],
  },
  {
    id: 'B',
    capability: 'Unsigned 2/4-bit RGB and 6-bit grayscale',
    dependencies: ['color-depth:2,2,2', 'color-depth:4,4,4', 'grayscale-depth:6'],
  },
  {
    id: 'C',
    capability: 'CMYK plus alpha',
    dependencies: ['cmyk-alpha'],
  },
  {
    id: 'D',
    capability: 'WebP-in-TIFF',
    dependencies: ['compression:50001'],
  },
] as const

const run = async (): Promise<void> => {
  const corpusRoot = resolve(argument('corpus', '../codec-corpus'))
  const reportPath = resolve(argument('report', 'benchmark/results/imazen-tiff-conformance.json'))
  const outputPath = resolve(argument('output', 'benchmark/results/imazen-tiff-dependencies.json'))
  const report = parseReport(JSON.parse(await readFile(reportPath, 'utf8')) as unknown)
  const unsupported = report.records.filter((record) => record.actualOutcome === 'unsupported')
  const files = await Promise.all(
    unsupported.map((record) => inspect(corpusRoot, record.relativeFilename)),
  )
  files.sort((left, right) => left.file.localeCompare(right.file))
  const dependencyCounts = Object.entries(
    files
      .flatMap((file) => file.dependencies)
      .reduce<Record<string, number>>((counts, dependency) => {
        counts[dependency] = (counts[dependency] ?? 0) + 1
        return counts
      }, {}),
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dependency, count]) => ({ dependency, count }))
  const currentPass = report.records.filter((record) => record.actualOutcome === 'pass').length
  const projectedFiles = new Set<string>()
  const implementationWaves = waveDefinitions.map((wave) => {
    const waveFiles = files
      .filter((file) =>
        file.dependencies.some((dependency) =>
          wave.dependencies.some((candidate) => candidate === dependency),
        ),
      )
      .map((file) => file.file)
    for (const file of waveFiles) projectedFiles.add(file)
    return {
      id: wave.id,
      capability: wave.capability,
      dependencies: wave.dependencies,
      visibleFiles: waveFiles.length,
      files: waveFiles,
      projectedPassAfterWave: currentPass + projectedFiles.size,
    }
  })
  const result = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceReport: basename(reportPath),
    unsupportedFiles: files.length,
    dependencyCounts,
    currentPass,
    projectedPass: currentPass + projectedFiles.size,
    implementationWaves,
    files,
  }
  await writeFile(outputPath, `${JSON.stringify(result, undefined, 2)}\n`)
  const markdownPath = outputPath.replace(/\.json$/u, '.md')
  const markdown = [
    '# Imazen TIFF unsupported dependency matrix',
    '',
    `Source report: \`${basename(reportPath)}\``,
    '',
    `Unsupported files inspected: ${files.length}`,
    `Projected first-expansion pass count: ${currentPass} → ${currentPass + projectedFiles.size}`,
    'ThunderScan is excluded from the projection: the sole Compression=32809 fixture is structurally invalid under independent LibTIFF and ImageMagick decoding.',
    '',
    '## Implementation dependency graph',
    '',
    '| Wave | Capability | Dependencies | Visible files | Projected pass |',
    '| --- | --- | --- | ---: | ---: |',
    ...implementationWaves.map(
      (wave) =>
        `| ${wave.id} | ${wave.capability} | ${wave.dependencies.join('<br>')} | ${wave.visibleFiles} | ${wave.projectedPassAfterWave} |`,
    ),
    '',
    '',
    '## Dependency counts',
    '',
    '| Dependency | Files |',
    '| --- | ---: |',
    ...dependencyCounts.map(({ dependency, count }) => `| ${dependency} | ${count} |`),
    '',
    '## File matrix',
    '',
    '| File | Bits | Sample format | SPP | Extra | Photo | Compression | Predictor | Planar | Geometry | Byte order | ICC | JPEGTables | SMin / SMax | Dependencies |',
    '| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |',
    ...files.map((file) => {
      const geometry =
        file.tileOffsets > 0
          ? `tiles ${markdownValues(file.tileWidth)}x${markdownValues(file.tileLength)} (${file.tileOffsets})`
          : `strips rows=${markdownValues(file.rowsPerStrip)} (${file.stripOffsets})`
      return `| \`${file.file}\` | ${markdownValues(file.bitsPerSample)} | ${markdownValues(file.sampleFormat)} | ${markdownValues(file.samplesPerPixel)} | ${markdownValues(file.extraSamples)} | ${markdownValues(file.photometric)} | ${markdownValues(file.compression)} | ${markdownValues(file.predictor)} | ${markdownValues(file.planarConfiguration)} | ${geometry} | ${file.byteOrder}${file.bigTiff ? ' BigTIFF' : ''} | ${file.hasIccProfile ? `${file.iccProfileBytes} B` : '-'} | ${file.jpegTablesBytes > 0 ? `${file.jpegTablesBytes} B` : '-'} | ${markdownValues(file.sMinSampleValue)} / ${markdownValues(file.sMaxSampleValue)} | ${file.dependencies.join('<br>') || '-'} |`
    }),
    '',
  ].join('\n')
  await writeFile(markdownPath, markdown)
  console.log(
    JSON.stringify(
      { json: outputPath, markdown: markdownPath, unsupportedFiles: files.length },
      undefined,
      2,
    ),
  )
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await run()
