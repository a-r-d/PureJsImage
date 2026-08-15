import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { MemorySource, readExactly, type ImageSource } from '../../source.ts'
import type { ScientificAxisDescriptor, ScientificMetadataObject } from '../dataset.ts'
import { normalizeScientificMetadataObject } from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
  ScientificResource,
} from '../reader.ts'
import {
  boundedGzipSource,
  createContiguousArrayDataset,
  type ContiguousArrayLimits,
} from './interchange-shared.ts'
import { resourceHasHint, singleDatasetDocument } from './shared.ts'

const magicPattern = /^NRRD000[1-5]$/u

export interface NrrdReaderLimits extends ContiguousArrayLimits {
  readonly maxHeaderBytes: number
  readonly maxInputBytes: number
  readonly maxDecodedBytes: number
  readonly maxDimensions: number
  readonly maxElements: number
  readonly maxMetadataEntries: number
}

export interface NrrdReaderOptions {
  readonly limits?: Partial<NrrdReaderLimits>
}

const defaults: Readonly<NrrdReaderLimits> = Object.freeze({
  maxHeaderBytes: 1_048_576,
  maxInputBytes: 1_073_741_824,
  maxDecodedBytes: 1_073_741_824,
  maxDimensions: 16,
  maxElements: 1_000_000_000,
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

const resolveLimits = (input: Partial<NrrdReaderLimits> = {}): Readonly<NrrdReaderLimits> =>
  Object.freeze({
    maxHeaderBytes: positive(input.maxHeaderBytes, defaults.maxHeaderBytes, 'NRRD maxHeaderBytes'),
    maxInputBytes: positive(input.maxInputBytes, defaults.maxInputBytes, 'NRRD maxInputBytes'),
    maxDecodedBytes: positive(
      input.maxDecodedBytes,
      defaults.maxDecodedBytes,
      'NRRD maxDecodedBytes',
    ),
    maxDimensions: positive(input.maxDimensions, defaults.maxDimensions, 'NRRD maxDimensions'),
    maxElements: positive(input.maxElements, defaults.maxElements, 'NRRD maxElements'),
    maxMetadataEntries: positive(
      input.maxMetadataEntries,
      defaults.maxMetadataEntries,
      'NRRD maxMetadataEntries',
    ),
    maxRegionBytes: positive(input.maxRegionBytes, defaults.maxRegionBytes, 'NRRD maxRegionBytes'),
    maxReadOperations: positive(
      input.maxReadOperations,
      defaults.maxReadOperations,
      'NRRD maxReadOperations',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'NRRD rowsPerBlock'),
  })

interface ParsedHeader {
  readonly version: string
  readonly fields: Readonly<Record<string, string>>
  readonly keyValues: Readonly<Record<string, string>>
  readonly dataOffset: number
  readonly attached: boolean
}

const blankLine = (bytes: Uint8Array): number => {
  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (bytes[index] === 10 && bytes[index + 1] === 10) return index + 2
    if (
      index < bytes.byteLength - 3 &&
      bytes[index] === 13 &&
      bytes[index + 1] === 10 &&
      bytes[index + 2] === 13 &&
      bytes[index + 3] === 10
    ) {
      return index + 4
    }
  }
  return -1
}

const parseHeader = (
  bytes: Uint8Array,
  sourceSize: number,
  limits: Readonly<NrrdReaderLimits>,
): ParsedHeader => {
  const separator = blankLine(bytes)
  const textBytes = separator < 0 ? bytes : bytes.subarray(0, separator)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes)
  } catch {
    throw invalidInput('NRRD header is not valid UTF-8')
  }
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const version = lines.shift()?.trim() ?? ''
  if (!magicPattern.test(version)) throw invalidInput('NRRD magic/version is invalid')
  const fields: Record<string, string> = {}
  const keyValues: Record<string, string> = {}
  let entries = 0
  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) continue
    entries += 1
    if (entries > limits.maxMetadataEntries)
      throw limitExceeded('NRRD metadata entry limit exceeded')
    const keyValue = line.indexOf(':=')
    if (keyValue >= 0) {
      const key = line.slice(0, keyValue)
      if (keyValues[key] !== undefined) throw invalidInput(`NRRD key ${key} occurs more than once`)
      keyValues[key] = line.slice(keyValue + 2)
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 1) throw invalidInput('NRRD header field is malformed')
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (fields[key] !== undefined) throw invalidInput(`NRRD field ${key} occurs more than once`)
    fields[key] = value
  }
  const detached = fields['data file'] !== undefined || fields.datafile !== undefined
  if (separator < 0 && !detached) {
    if (sourceSize > bytes.byteLength)
      throw limitExceeded('NRRD header exceeds its configured limit')
    throw invalidInput('Attached NRRD header is missing its blank-line terminator')
  }
  return Object.freeze({
    version,
    fields: Object.freeze(fields),
    keyValues: Object.freeze(keyValues),
    dataOffset: separator < 0 ? bytes.byteLength : separator,
    attached: !detached,
  })
}

const required = (fields: Readonly<Record<string, string>>, key: string): string => {
  const value = fields[key]
  if (value === undefined || value.length === 0) throw invalidInput(`NRRD requires ${key}`)
  return value
}

const integerList = (value: string, label: string): readonly number[] => {
  const values = value.trim().split(/\s+/u).map(Number)
  if (values.length === 0 || values.some((entry) => !Number.isSafeInteger(entry) || entry < 1)) {
    throw invalidInput(`NRRD ${label} is invalid`)
  }
  return Object.freeze(values)
}

const tokens = (value: string): readonly string[] => {
  const result: string[] = []
  let start = -1
  let quoted = false
  let parentheses = 0
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index]
    if (start < 0) {
      if (character !== undefined && !/\s/u.test(character)) start = index
      else continue
    }
    if (character === '"' && value[index - 1] !== '\\') quoted = !quoted
    if (!quoted && character === '(') parentheses += 1
    if (!quoted && character === ')') parentheses -= 1
    if (parentheses < 0) throw invalidInput('NRRD metadata has unmatched parentheses')
    if (character === undefined || (!quoted && parentheses === 0 && /\s/u.test(character))) {
      const token = value.slice(start, index)
      result.push(
        token.startsWith('"') && token.endsWith('"')
          ? token.slice(1, -1).replaceAll('\\"', '"')
          : token,
      )
      start = -1
    }
  }
  if (quoted || parentheses !== 0) throw invalidInput('NRRD metadata token is unterminated')
  return Object.freeze(result)
}

const sampleType = (raw: string): RasterSampleType => {
  const type = raw
    .toLowerCase()
    .replaceAll(/[_\s-]+/gu, ' ')
    .trim()
  if (['uchar', 'unsigned char', 'uint8', 'uint8 t'].includes(type)) return 'uint8'
  if (['signed char', 'int8', 'int8 t'].includes(type)) return 'int8'
  if (['ushort', 'unsigned short', 'uint16', 'uint16 t'].includes(type)) return 'uint16'
  if (['short', 'short int', 'signed short', 'int16', 'int16 t'].includes(type)) return 'int16'
  if (['uint', 'unsigned int', 'uint32', 'uint32 t'].includes(type)) return 'uint32'
  if (['int', 'signed int', 'int32', 'int32 t'].includes(type)) return 'int32'
  if (['float', 'float32'].includes(type)) return 'float32'
  if (['double', 'float64'].includes(type)) return 'float64'
  if (['ullong', 'unsigned long long', 'uint64', 'uint64 t'].includes(type)) return 'uint64'
  throw unsupportedOperation(`NRRD type ${raw} is unsupported`)
}

const vector = (value: string): readonly number[] => {
  const match = value.match(/^\((.*)\)$/u)
  if (match === null) throw invalidInput(`NRRD vector ${value} is invalid`)
  const values = (match[1] ?? '').split(',').map((part) => Number(part.trim()))
  if (values.length === 0 || values.some((entry) => !Number.isFinite(entry))) {
    throw invalidInput(`NRRD vector ${value} is invalid`)
  }
  return Object.freeze(values)
}

const axisKind = (kind: string | undefined): ScientificAxisDescriptor['kind'] => {
  if (kind === undefined) return 'index'
  const normalized = kind.toLowerCase()
  if (normalized.includes('time')) return 'time'
  if (['domain', 'space'].includes(normalized)) return 'space'
  if (['list', 'vector', 'color', 'rgb-color', 'rgba-color'].includes(normalized)) return 'channel'
  return 'other'
}

const axesFor = (
  header: ParsedHeader,
  sizes: readonly number[],
  resourceId: string,
): readonly ScientificAxisDescriptor[] => {
  const labels = header.fields.labels === undefined ? [] : tokens(header.fields.labels)
  const units = header.fields.units === undefined ? [] : tokens(header.fields.units)
  const kinds = header.fields.kinds?.trim().split(/\s+/u) ?? []
  const spacingTokens = header.fields.spacings?.trim().split(/\s+/u) ?? []
  const spacings = spacingTokens.map((entry) => {
    if (/^(?:nan|none)$/iu.test(entry)) return undefined
    const parsed = Number(entry)
    if (!Number.isFinite(parsed)) throw invalidInput(`NRRD spacing ${entry} is invalid`)
    return parsed
  })
  const directionTokens =
    header.fields['space directions'] === undefined ? [] : tokens(header.fields['space directions'])
  const directions = directionTokens.map((entry) =>
    entry.toLowerCase() === 'none' ? undefined : vector(entry),
  )
  const origin =
    header.fields['space origin'] === undefined ? undefined : vector(header.fields['space origin'])
  return Object.freeze(
    sizes.map((length, index) => {
      const direction = directions[index]
      const spacing =
        direction === undefined
          ? spacings[index]
          : Math.sqrt(direction.reduce((sum, component) => sum + component * component, 0))
      const calibrated = spacing !== undefined && Number.isFinite(spacing) && spacing !== 0
      const directionComponent = direction?.findIndex((component) => component !== 0)
      const directionComponents = direction?.filter((component) => component !== 0).length ?? 0
      const coordinateOrigin =
        direction !== undefined && directionComponents === 1 && directionComponent !== undefined
          ? (origin?.[directionComponent] ?? 0)
          : direction === undefined
            ? (origin?.[index] ?? 0)
            : 0
      return Object.freeze({
        id: `axis${index}`,
        name: labels[index] ?? `Axis ${index}`,
        kind: axisKind(kinds[index]),
        length,
        ...(units[index] === undefined ? {} : { unit: units[index] }),
        coordinates: calibrated
          ? Object.freeze({ type: 'linear' as const, origin: coordinateOrigin, step: spacing })
          : Object.freeze({ type: 'index' as const }),
        ...(calibrated
          ? {
              calibration: Object.freeze({
                kind: 'embedded' as const,
                resourceId,
                locator:
                  direction === undefined
                    ? `nrrd:spacings[${index}]`
                    : `nrrd:space directions[${index}],space origin`,
                ...(direction === undefined
                  ? {}
                  : {
                      note:
                        directionComponents === 1
                          ? `Full direction vector (${direction.join(', ')}) is preserved in NRRD metadata.`
                          : `Rotated direction (${direction.join(', ')}) and space origin are preserved in metadata; the scalar axis origin remains zero because the full affine is not separable.`,
                    }),
              }),
            }
          : {}),
      })
    }),
  )
}

const dataResource = async (
  context: Readonly<ScientificOpenContext>,
  header: ParsedHeader,
): Promise<ScientificResource> => {
  if (header.attached) return context.primary
  const name = header.fields['data file'] ?? header.fields.datafile
  if (name === undefined) throw invalidInput('Detached NRRD data filename is missing')
  if (/\bLIST\b|%/iu.test(name) || name.trim().split(/\s+/u).length !== 1) {
    throw unsupportedOperation('NRRD multi-file data lists are unsupported')
  }
  if (context.companions === undefined)
    throw invalidInput('Detached NRRD requires a companion resolver')
  const resource = await context.companions.resolve(
    { kind: 'relative-name', name },
    context.signal === undefined ? {} : { signal: context.signal },
  )
  if (resource === undefined) throw invalidInput(`NRRD data companion ${name} is missing`)
  return resource
}

export const nrrdReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/nrrd',
  version: '1.0.0',
  format: 'NRRD',
  extensions: Object.freeze(['nrrd', 'nhdr']),
  mediaTypes: Object.freeze(['application/x-nrrd']),
  capabilities: Object.freeze({ resources: 'single-or-pair', datasets: 'single', axes: 'ranked' }),
})

export const createNrrdReader = (options: Readonly<NrrdReaderOptions> = {}): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: nrrdReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        8,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const text = new TextDecoder().decode(bytes)
      if (!/^NRRD000[1-5]$/u.test(text))
        return Object.freeze({ confidence: 0, reason: 'NRRD magic is absent' })
      const hinted = resourceHasHint(
        context.primary,
        nrrdReaderDescriptor.extensions,
        nrrdReaderDescriptor.mediaTypes,
      )
      return Object.freeze({ confidence: hinted ? 1 : 0.99, reason: 'NRRD magic matches' })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      const prefixLength = Math.min(context.primary.source.size, limits.maxHeaderBytes)
      const prefix = await readExactly(
        context.primary.source,
        0,
        prefixLength,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const header = parseHeader(prefix, context.primary.source.size, limits)
      const dimension = Number(required(header.fields, 'dimension'))
      if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > limits.maxDimensions) {
        throw limitExceeded(`NRRD dimension exceeds ${limits.maxDimensions}`)
      }
      const sizes = integerList(required(header.fields, 'sizes'), 'sizes')
      if (sizes.length !== dimension)
        throw invalidInput('NRRD sizes count does not match dimension')
      let elements = 1
      for (const size of sizes) {
        elements *= size
        if (!Number.isSafeInteger(elements) || elements > limits.maxElements)
          throw limitExceeded('NRRD element limit exceeded')
      }
      const type = sampleType(required(header.fields, 'type'))
      const encoding = required(header.fields, 'encoding').toLowerCase()
      if (!['raw', 'gzip', 'gz'].includes(encoding))
        throw unsupportedOperation(`NRRD encoding ${encoding} is unsupported`)
      const endian =
        header.fields.endian?.toLowerCase() ??
        (rasterSampleBytes(type) === 1 ? 'little' : undefined)
      if (rasterSampleBytes(type) > 1 && endian !== 'little' && endian !== 'big')
        throw invalidInput('NRRD multi-byte data requires little or big endian')
      const lineSkip = Number(header.fields['line skip'] ?? '0')
      const byteSkip = Number(header.fields['byte skip'] ?? '0')
      if (lineSkip !== 0 || !Number.isSafeInteger(byteSkip) || byteSkip < 0)
        throw unsupportedOperation('NRRD supports only non-negative byte skip and zero line skip')
      const resource = await dataResource(context, header)
      const rawOffset = header.attached ? header.dataOffset + byteSkip : byteSkip
      const payloadBytes = elements * rasterSampleBytes(type)
      if (!Number.isSafeInteger(payloadBytes) || payloadBytes > limits.maxDecodedBytes)
        throw limitExceeded('NRRD decoded payload exceeds its limit')
      let source: ImageSource
      let dataOffset: number
      if (encoding === 'raw') {
        if (rawOffset + payloadBytes !== resource.source.size)
          throw invalidInput('NRRD raw payload size is invalid')
        source = resource.source
        dataOffset = rawOffset
      } else {
        const compressedBytes = resource.source.size - rawOffset
        if (!Number.isSafeInteger(compressedBytes) || compressedBytes < 1)
          throw invalidInput('NRRD gzip payload is missing')
        if (compressedBytes > limits.maxInputBytes)
          throw limitExceeded('NRRD gzip payload exceeds maxInputBytes')
        const compressed = await readExactly(
          resource.source,
          rawOffset,
          compressedBytes,
          context.signal === undefined ? {} : { signal: context.signal },
        )
        source = await boundedGzipSource(
          new MemorySource(compressed),
          limits.maxInputBytes,
          limits.maxDecodedBytes,
          context.signal,
        )
        if (source.size !== payloadBytes)
          throw invalidInput('NRRD gzip output size does not match dimensions')
        dataOffset = 0
      }
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        version: header.version,
        encoding,
        endian: endian ?? 'not-applicable',
        fields: header.fields,
        keyValues: header.keyValues,
      })
      const dataset = createContiguousArrayDataset({
        source,
        dataOffset,
        sourceSampleType: type,
        sourceLittleEndian: endian !== 'big',
        axes: axesFor(header, sizes, header.attached ? context.primary.id : resource.id),
        components: [
          Object.freeze({ id: 'value', name: header.fields.content ?? 'Value', kind: 'scalar' }),
        ],
        metadata,
        limits,
      })
      return singleDatasetDocument({
        context,
        reader: nrrdReaderDescriptor,
        metadata,
        dataset,
        datasetId: 'array',
        datasetName: header.fields.content ?? 'NRRD array',
        resources: header.attached
          ? [context.primary]
          : [
              Object.freeze({ id: 'header', source: context.primary.source }),
              Object.freeze({ id: 'data', source: resource.source }),
            ],
      })
    },
  })
}

export const nrrdReader = createNrrdReader()
