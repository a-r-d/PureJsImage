import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import { MemorySource, readExactly } from '../../source.ts'
import type {
  ScientificAxisDescriptor,
  ScientificComponentDescriptor,
  ScientificMetadataObject,
} from '../dataset.ts'
import { normalizeScientificMetadataObject } from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createContiguousArrayDataset, type ContiguousArrayLimits } from './interchange-shared.ts'
import { resourceHasHint, singleDatasetDocument } from './shared.ts'

export interface EbsdTextReaderLimits extends ContiguousArrayLimits {
  readonly maxInputBytes: number
  readonly maxDecodedBytes: number
  readonly maxPoints: number
  readonly maxColumns: number
  readonly maxMetadataEntries: number
}

export interface EbsdTextReaderOptions {
  readonly limits?: Partial<EbsdTextReaderLimits>
}

interface ParsedEbsd {
  readonly dialect: 'ANG' | 'CTF'
  readonly width: number
  readonly height: number
  readonly xStep: number
  readonly yStep: number
  readonly xOrigin: number
  readonly yOrigin: number
  readonly components: readonly ScientificComponentDescriptor[]
  readonly values: readonly (readonly number[])[]
  readonly metadata: ScientificMetadataObject
}

const defaults: Readonly<EbsdTextReaderLimits> = Object.freeze({
  maxInputBytes: 268_435_456,
  maxDecodedBytes: 536_870_912,
  maxPoints: 16_777_216,
  maxColumns: 32,
  maxMetadataEntries: 4_096,
  maxRegionBytes: 67_108_864,
  maxReadOperations: 1_048_576,
  rowsPerBlock: 32,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1)
    throw invalidInput(`${label} must be positive`)
  return resolved
}

const resolveLimits = (input: Partial<EbsdTextReaderLimits> = {}): Readonly<EbsdTextReaderLimits> =>
  Object.freeze({
    maxInputBytes: positive(input.maxInputBytes, defaults.maxInputBytes, 'EBSD maxInputBytes'),
    maxDecodedBytes: positive(
      input.maxDecodedBytes,
      defaults.maxDecodedBytes,
      'EBSD maxDecodedBytes',
    ),
    maxPoints: positive(input.maxPoints, defaults.maxPoints, 'EBSD maxPoints'),
    maxColumns: positive(input.maxColumns, defaults.maxColumns, 'EBSD maxColumns'),
    maxMetadataEntries: positive(
      input.maxMetadataEntries,
      defaults.maxMetadataEntries,
      'EBSD maxMetadataEntries',
    ),
    maxRegionBytes: positive(input.maxRegionBytes, defaults.maxRegionBytes, 'EBSD maxRegionBytes'),
    maxReadOperations: positive(
      input.maxReadOperations,
      defaults.maxReadOperations,
      'EBSD maxReadOperations',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'EBSD rowsPerBlock'),
  })

const finite = (value: string | undefined, label: string): number => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw invalidInput(`EBSD ${label} is invalid`)
  return number
}

const positiveInteger = (value: string | undefined, label: string): number => {
  const number = finite(value, label)
  if (!Number.isSafeInteger(number) || number < 1) throw invalidInput(`EBSD ${label} is invalid`)
  return number
}

const metadataMap = (
  entries: readonly (readonly [string, string])[],
  limit: number,
): Readonly<Record<string, string>> => {
  if (entries.length > limit) throw limitExceeded('EBSD metadata entry limit exceeded')
  const result: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (result[key] === undefined) result[key] = value
  }
  return Object.freeze(result)
}

const numericRows = (
  lines: readonly string[],
  expectedColumns: number,
  limits: Readonly<EbsdTextReaderLimits>,
): readonly (readonly number[])[] => {
  if (expectedColumns > limits.maxColumns) throw limitExceeded('EBSD column limit exceeded')
  const rows: (readonly number[])[] = []
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const values = line.trim().split(/\s+/u).map(Number)
    if (values.length < expectedColumns || values.some((value) => !Number.isFinite(value))) {
      throw invalidInput('EBSD data row is malformed')
    }
    rows.push(Object.freeze(values.slice(0, expectedColumns)))
    if (rows.length > limits.maxPoints) throw limitExceeded('EBSD point limit exceeded')
    const decodedBytes = rows.length * expectedColumns * 8
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > limits.maxDecodedBytes)
      throw limitExceeded('EBSD decoded values exceed maxDecodedBytes')
  }
  return Object.freeze(rows)
}

const verifyGrid = (
  values: readonly (readonly number[])[],
  width: number,
  height: number,
  xColumn: number,
  yColumn: number,
  xStep: number,
  yStep: number,
): { readonly xOrigin: number; readonly yOrigin: number } => {
  if (values.length !== width * height)
    throw invalidInput('EBSD point count does not match its grid')
  const xOrigin = values[0]?.[xColumn]
  const yOrigin = values[0]?.[yColumn]
  if (xOrigin === undefined || yOrigin === undefined) throw invalidInput('EBSD grid has no origin')
  const tolerance = Math.max(Math.abs(xStep), Math.abs(yStep), 1) * 1e-5
  for (let index = 0; index < values.length; index += 1) {
    const row = Math.floor(index / width)
    const column = index % width
    const x = values[index]?.[xColumn]
    const y = values[index]?.[yColumn]
    if (
      x === undefined ||
      y === undefined ||
      Math.abs(x - (xOrigin + column * xStep)) > tolerance ||
      Math.abs(y - (yOrigin + row * yStep)) > tolerance
    ) {
      throw unsupportedOperation('Only rectangular, row-major EBSD grids are supported')
    }
  }
  return Object.freeze({ xOrigin, yOrigin })
}

const angComponents = Object.freeze([
  Object.freeze({ id: 'euler1', name: 'Euler 1', kind: 'other' as const, unit: 'rad' }),
  Object.freeze({ id: 'euler2', name: 'Euler 2', kind: 'other' as const, unit: 'rad' }),
  Object.freeze({ id: 'euler3', name: 'Euler 3', kind: 'other' as const, unit: 'rad' }),
  Object.freeze({ id: 'xPosition', name: 'X position', kind: 'other' as const, unit: 'µm' }),
  Object.freeze({ id: 'yPosition', name: 'Y position', kind: 'other' as const, unit: 'µm' }),
  Object.freeze({ id: 'imageQuality', name: 'Image quality', kind: 'intensity' as const }),
  Object.freeze({ id: 'confidenceIndex', name: 'Confidence index', kind: 'other' as const }),
  Object.freeze({ id: 'phase', name: 'Phase', kind: 'other' as const }),
])

const parseAng = (text: string, limits: Readonly<EbsdTextReaderLimits>): ParsedEbsd => {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const entries: (readonly [string, string])[] = []
  let dataStart = 0
  for (; dataStart < lines.length; dataStart += 1) {
    const line = lines[dataStart]?.trim() ?? ''
    if (!line.startsWith('#')) break
    const body = line.slice(1).trim()
    const match = body.match(/^([^:=]+?)\s*(?::|=|\s)\s*(.*)$/u)
    if (match !== null)
      entries.push(Object.freeze([match[1]?.trim().toUpperCase() ?? '', match[2]?.trim() ?? '']))
  }
  const header = metadataMap(entries, limits.maxMetadataEntries)
  const grid = header.GRID?.toLowerCase()
  if (grid !== undefined && !grid.includes('sqrgrid')) {
    throw unsupportedOperation('Hexagonal ANG grids are unsupported')
  }
  const odd = positiveInteger(header.NCOLS_ODD, 'ANG NCOLS_ODD')
  const even = positiveInteger(header.NCOLS_EVEN ?? header.NCOLS_ODD, 'ANG NCOLS_EVEN')
  if (odd !== even) throw unsupportedOperation('Staggered ANG grids are unsupported')
  const height = positiveInteger(header.NROWS, 'ANG NROWS')
  const xStep = finite(header.XSTEP, 'ANG XSTEP')
  const yStep = finite(header.YSTEP, 'ANG YSTEP')
  if (xStep <= 0 || yStep <= 0) throw invalidInput('ANG grid steps must be positive')
  const rawRows = numericRows(lines.slice(dataStart), 8, limits)
  const origin = verifyGrid(rawRows, odd, height, 3, 4, xStep, yStep)
  return Object.freeze({
    dialect: 'ANG',
    width: odd,
    height,
    xStep,
    yStep,
    ...origin,
    components: angComponents,
    values: Object.freeze(rawRows.map((row) => Object.freeze(row.slice(0, 8)))),
    metadata: normalizeScientificMetadataObject({ dialect: 'ANG', header }),
  })
}

const ctfComponents = Object.freeze([
  Object.freeze({ id: 'phase', name: 'Phase', kind: 'other' as const }),
  Object.freeze({ id: 'xPosition', name: 'X position', kind: 'other' as const, unit: 'µm' }),
  Object.freeze({ id: 'yPosition', name: 'Y position', kind: 'other' as const, unit: 'µm' }),
  Object.freeze({ id: 'bands', name: 'Bands', kind: 'other' as const }),
  Object.freeze({ id: 'error', name: 'Error', kind: 'other' as const }),
  Object.freeze({ id: 'euler1', name: 'Euler 1', kind: 'other' as const, unit: 'deg' }),
  Object.freeze({ id: 'euler2', name: 'Euler 2', kind: 'other' as const, unit: 'deg' }),
  Object.freeze({ id: 'euler3', name: 'Euler 3', kind: 'other' as const, unit: 'deg' }),
  Object.freeze({ id: 'mad', name: 'Mean angular deviation', kind: 'other' as const, unit: 'deg' }),
  Object.freeze({ id: 'bandContrast', name: 'Band contrast', kind: 'intensity' as const }),
  Object.freeze({ id: 'bandSlope', name: 'Band slope', kind: 'intensity' as const }),
])

const parseCtf = (text: string, limits: Readonly<EbsdTextReaderLimits>): ParsedEbsd => {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  if (lines[0]?.trim() !== 'Channel Text File') throw invalidInput('CTF signature is invalid')
  const columnIndex = lines.findIndex((line) => /^Phase\s+X\s+Y\s+/u.test(line.trim()))
  if (columnIndex < 0) throw invalidInput('CTF column header is missing')
  const entries: (readonly [string, string])[] = []
  for (const line of lines.slice(1, columnIndex)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const parts = trimmed.split(/\t+|\s+/u)
    const key = parts.shift() ?? ''
    if (/^(XCells|YCells|XStep|YStep|JobMode)$/u.test(key)) {
      entries.push(Object.freeze([key, parts.join(' ')]))
    }
  }
  const header = metadataMap(entries, limits.maxMetadataEntries)
  const width = positiveInteger(header.XCells, 'CTF XCells')
  const height = positiveInteger(header.YCells, 'CTF YCells')
  const xStep = finite(header.XStep, 'CTF XStep')
  const yStep = finite(header.YStep, 'CTF YStep')
  if (xStep <= 0 || yStep <= 0) throw invalidInput('CTF grid steps must be positive')
  const rawRows = numericRows(lines.slice(columnIndex + 1), 11, limits)
  const origin = verifyGrid(rawRows, width, height, 1, 2, xStep, yStep)
  return Object.freeze({
    dialect: 'CTF',
    width,
    height,
    xStep,
    yStep,
    ...origin,
    components: ctfComponents,
    values: rawRows,
    metadata: normalizeScientificMetadataObject({ dialect: 'CTF', header }),
  })
}

const encodeValues = (parsed: ParsedEbsd): Uint8Array => {
  const bytes = new Uint8Array(parsed.values.length * parsed.components.length * 8)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (const row of parsed.values) {
    for (const value of row) {
      view.setFloat64(offset, value, false)
      offset += 8
    }
  }
  return bytes
}

const axesFor = (parsed: ParsedEbsd, resourceId: string): readonly ScientificAxisDescriptor[] =>
  Object.freeze([
    Object.freeze({
      id: 'x',
      name: 'X',
      kind: 'space' as const,
      length: parsed.width,
      unit: 'µm',
      coordinates: Object.freeze({
        type: 'linear' as const,
        origin: parsed.xOrigin,
        step: parsed.xStep,
      }),
      calibration: Object.freeze({
        kind: 'embedded' as const,
        resourceId,
        locator: parsed.dialect === 'ANG' ? 'ang:XSTEP,data.x' : 'ctf:XStep,data.X',
      }),
    }),
    Object.freeze({
      id: 'y',
      name: 'Y',
      kind: 'space' as const,
      length: parsed.height,
      unit: 'µm',
      coordinates: Object.freeze({
        type: 'linear' as const,
        origin: parsed.yOrigin,
        step: parsed.yStep,
      }),
      calibration: Object.freeze({
        kind: 'embedded' as const,
        resourceId,
        locator: parsed.dialect === 'ANG' ? 'ang:YSTEP,data.y' : 'ctf:YStep,data.Y',
      }),
    }),
  ])

export const ebsdTextReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/ebsd-text',
  version: '1.0.0',
  format: 'ANG/CTF orientation map',
  extensions: Object.freeze(['ang', 'ctf']),
  mediaTypes: Object.freeze(['application/x-ebsd-ang', 'application/x-ebsd-ctf']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'orientation-map' }),
})

export const createEbsdTextReader = (
  options: Readonly<EbsdTextReaderOptions> = {},
): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: ebsdTextReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        Math.min(context.primary.source.size, 8_192),
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const text = new TextDecoder().decode(bytes)
      const dialect = text.startsWith('Channel Text File')
        ? 'CTF'
        : /^#.*(?:GRID|XSTEP|NCOLS_ODD)/mu.test(text)
          ? 'ANG'
          : undefined
      if (dialect === undefined)
        return Object.freeze({ confidence: 0, reason: 'ANG/CTF structure is absent' })
      const hinted = resourceHasHint(
        context.primary,
        ebsdTextReaderDescriptor.extensions,
        ebsdTextReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 0.99 : 0.92,
        reason: `${dialect} text structure matches`,
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      if (context.primary.source.size > limits.maxInputBytes) {
        throw limitExceeded('EBSD input exceeds maxInputBytes')
      }
      const bytes = await readExactly(
        context.primary.source,
        0,
        context.primary.source.size,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw invalidInput('EBSD text is not valid UTF-8')
      }
      const parsed = text.startsWith('Channel Text File')
        ? parseCtf(text, limits)
        : parseAng(text, limits)
      const decodedBytes = parsed.values.length * parsed.components.length * 8
      if (!Number.isSafeInteger(decodedBytes) || decodedBytes > limits.maxDecodedBytes) {
        throw limitExceeded('EBSD decoded values exceed maxDecodedBytes')
      }
      const payload = encodeValues(parsed)
      const dataset = createContiguousArrayDataset({
        source: new MemorySource(payload),
        dataOffset: 0,
        sourceSampleType: 'float64',
        sourceLittleEndian: false,
        axes: axesFor(parsed, context.primary.id),
        components: parsed.components,
        metadata: parsed.metadata,
        planePairs: [Object.freeze(['x', 'y'])],
        limits,
      })
      return singleDatasetDocument({
        context,
        reader: ebsdTextReaderDescriptor,
        metadata: parsed.metadata,
        dataset,
        datasetId: 'orientation-map',
        datasetName: `${parsed.dialect} orientation map`,
      })
    },
  })
}

export const ebsdTextReader = createEbsdTextReader()
