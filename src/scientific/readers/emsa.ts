import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import { MemorySource, readExactly } from '../../source.ts'
import type { ScientificMetadataObject } from '../dataset.ts'
import { normalizeScientificMetadataObject } from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createContiguousArrayDataset, type ContiguousArrayLimits } from './interchange-shared.ts'
import { resourceHasHint, singleDatasetDocument } from './shared.ts'

export interface EmsaReaderLimits extends ContiguousArrayLimits {
  readonly maxInputBytes: number
  readonly maxPoints: number
  readonly maxMetadataEntries: number
}

export interface EmsaReaderOptions {
  readonly limits?: Partial<EmsaReaderLimits>
}

const defaults: Readonly<EmsaReaderLimits> = Object.freeze({
  maxInputBytes: 16_777_216,
  maxPoints: 1_000_000,
  maxMetadataEntries: 1_024,
  maxRegionBytes: 67_108_864,
  maxReadOperations: 16,
  rowsPerBlock: 1,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (input: Partial<EmsaReaderLimits> = {}): Readonly<EmsaReaderLimits> =>
  Object.freeze({
    maxInputBytes: positive(input.maxInputBytes, defaults.maxInputBytes, 'EMSA maxInputBytes'),
    maxPoints: positive(input.maxPoints, defaults.maxPoints, 'EMSA maxPoints'),
    maxMetadataEntries: positive(
      input.maxMetadataEntries,
      defaults.maxMetadataEntries,
      'EMSA maxMetadataEntries',
    ),
    maxRegionBytes: positive(input.maxRegionBytes, defaults.maxRegionBytes, 'EMSA maxRegionBytes'),
    maxReadOperations: positive(
      input.maxReadOperations,
      defaults.maxReadOperations,
      'EMSA maxReadOperations',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'EMSA rowsPerBlock'),
  })

interface ParsedEmsa {
  readonly fields: Readonly<Record<string, readonly string[]>>
  readonly x: readonly number[]
  readonly y: readonly number[]
  readonly dataType: 'Y' | 'XY'
}

const first = (
  fields: Readonly<Record<string, readonly string[]>>,
  key: string,
): string | undefined => fields[key]?.[0]

const required = (fields: Readonly<Record<string, readonly string[]>>, key: string): string => {
  const value = first(fields, key)
  if (value === undefined || value.length === 0) throw invalidInput(`EMSA requires #${key}`)
  return value
}

const finite = (value: string, label: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw invalidInput(`${label} must be finite`)
  return parsed
}

const parseEmsa = (text: string, limits: Readonly<EmsaReaderLimits>): ParsedEmsa => {
  const fields: Record<string, string[]> = {}
  const dataLines: string[] = []
  let inData = false
  let ended = false
  let entries = 0
  for (const line of text.split(/\r?\n|\r/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (inData && !trimmed.startsWith('#')) {
      dataLines.push(trimmed)
      continue
    }
    if (!trimmed.startsWith('#')) {
      if (ended) throw invalidInput('EMSA contains content after #ENDOFDATA')
      continue
    }
    const separator = trimmed.indexOf(':')
    const key = (separator < 0 ? trimmed.slice(1) : trimmed.slice(1, separator))
      .trim()
      .toUpperCase()
    const value = separator < 0 ? '' : trimmed.slice(separator + 1).trim()
    if (key === 'SPECTRUM') {
      inData = true
      continue
    }
    if (key === 'ENDOFDATA') {
      ended = true
      inData = false
      continue
    }
    if (ended) throw invalidInput('EMSA contains content after #ENDOFDATA')
    entries += 1
    if (entries > limits.maxMetadataEntries) {
      throw limitExceeded(`EMSA metadata exceeds ${limits.maxMetadataEntries} entries`)
    }
    const values = fields[key]
    if (values === undefined) fields[key] = [value]
    else values.push(value)
  }
  const format = required(fields, 'FORMAT').toUpperCase()
  if (!format.includes('EMSA') && !format.includes('MAS')) {
    throw invalidInput('EMSA #FORMAT does not identify the standard')
  }
  if (!ended) throw invalidInput('EMSA #ENDOFDATA marker is missing')
  const dataTypeText = required(fields, 'DATATYPE').toUpperCase().replaceAll(' ', '')
  const dataType: 'Y' | 'XY' =
    dataTypeText === 'Y'
      ? 'Y'
      : dataTypeText === 'XY'
        ? 'XY'
        : (() => {
            throw unsupportedOperation(`EMSA DATATYPE ${dataTypeText} is unsupported`)
          })()
  const numbers = dataLines
    .join(',')
    .split(/[\s,;]+/u)
    .filter((part) => part.length > 0)
    .map((part) => finite(part, 'EMSA spectrum value'))
  const declared = Number(required(fields, 'NPOINTS'))
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > limits.maxPoints) {
    throw limitExceeded(`EMSA NPOINTS exceeds ${limits.maxPoints}`)
  }
  if (numbers.length !== declared * (dataType === 'XY' ? 2 : 1)) {
    throw invalidInput('EMSA spectrum value count does not match NPOINTS and DATATYPE')
  }
  const x: number[] = []
  const y: number[] = []
  if (dataType === 'XY') {
    for (let index = 0; index < numbers.length; index += 2) {
      x.push(numbers[index] ?? 0)
      y.push(numbers[index + 1] ?? 0)
    }
  } else {
    const origin = finite(required(fields, 'OFFSET'), 'EMSA OFFSET')
    const step = finite(required(fields, 'XPERCHAN'), 'EMSA XPERCHAN')
    if (step === 0) throw invalidInput('EMSA XPERCHAN must not be zero')
    for (let index = 0; index < declared; index += 1) x.push(origin + index * step)
    y.push(...numbers)
  }
  return Object.freeze({
    fields: Object.freeze(
      Object.fromEntries(
        Object.entries(fields).map(([key, values]) => [key, Object.freeze(values)]),
      ),
    ),
    x: Object.freeze(x),
    y: Object.freeze(y),
    dataType,
  })
}

const coordinates = (values: readonly number[]) => {
  const firstValue = values[0] ?? 0
  const step = (values[1] ?? firstValue) - firstValue
  const tolerance = Math.max(1, Math.abs(firstValue), Math.abs(step)) * 1e-12
  return values.length > 1 &&
    step !== 0 &&
    values.every((value, index) => Math.abs(value - (firstValue + index * step)) <= tolerance)
    ? Object.freeze({ type: 'linear' as const, origin: firstValue, step })
    : Object.freeze({ type: 'lookup' as const, values })
}

export const emsaReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/emsa',
  version: '1.0.0',
  format: 'EMSA/MAS spectrum',
  extensions: Object.freeze(['msa', 'emsa']),
  mediaTypes: Object.freeze(['application/x-emsa-mas']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'spectrum' }),
})

export const createEmsaReader = (options: Readonly<EmsaReaderOptions> = {}): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: emsaReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        Math.min(context.primary.source.size, 4_096),
        context.signal === undefined ? {} : { signal: context.signal },
      )
      let text: string
      try {
        text = new TextDecoder('latin1', { fatal: true }).decode(bytes)
      } catch {
        return Object.freeze({ confidence: 0, reason: 'EMSA text is invalid' })
      }
      const matches =
        /^#FORMAT\s*:.*(?:EMSA|MAS)/imu.test(text) && /^#(?:SPECTRUM|NPOINTS)\b/imu.test(text)
      if (!matches)
        return Object.freeze({ confidence: 0, reason: 'EMSA structural fields are absent' })
      const hinted = resourceHasHint(
        context.primary,
        emsaReaderDescriptor.extensions,
        emsaReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: 'EMSA structural fields match',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      if (context.primary.source.size > limits.maxInputBytes) {
        throw limitExceeded(`EMSA input exceeds ${limits.maxInputBytes} bytes`)
      }
      const bytes = await readExactly(
        context.primary.source,
        0,
        context.primary.source.size,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      let text: string
      try {
        text = new TextDecoder('latin1', { fatal: true }).decode(bytes)
      } catch {
        throw invalidInput('EMSA file is not valid Latin-1 text')
      }
      const parsed = parseEmsa(text, limits)
      const payload = new Uint8Array(parsed.y.length * 8)
      const view = new DataView(payload.buffer)
      for (let index = 0; index < parsed.y.length; index += 1) {
        view.setFloat64(index * 8, parsed.y[index] ?? 0, false)
      }
      const xUnit = first(parsed.fields, 'XUNITS')
      const yUnit = first(parsed.fields, 'YUNITS')
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        version: first(parsed.fields, 'VERSION') ?? '',
        dataType: parsed.dataType,
        fields: parsed.fields,
      })
      const dataset = createContiguousArrayDataset({
        source: new MemorySource(payload),
        dataOffset: 0,
        sourceSampleType: 'float64',
        sourceLittleEndian: false,
        axes: [
          Object.freeze({
            id: 'spectral',
            name: first(parsed.fields, 'XLABEL') ?? 'Spectrum',
            kind: 'spectral',
            length: parsed.x.length,
            ...(xUnit === undefined || xUnit.length === 0 ? {} : { unit: xUnit }),
            coordinates: coordinates(parsed.x),
            calibration: Object.freeze({
              kind: 'embedded' as const,
              resourceId: context.primary.id,
              locator: parsed.dataType === 'Y' ? 'emsa:#OFFSET,#XPERCHAN' : 'emsa:#SPECTRUM:x',
            }),
          }),
        ],
        components: [
          Object.freeze({
            id: 'intensity',
            name: first(parsed.fields, 'YLABEL') ?? first(parsed.fields, 'TITLE') ?? 'Intensity',
            kind: 'intensity',
            ...(yUnit === undefined || yUnit.length === 0 ? {} : { unit: yUnit }),
          }),
        ],
        metadata,
        limits,
      })
      return singleDatasetDocument({
        context,
        reader: emsaReaderDescriptor,
        metadata,
        dataset,
        datasetId: 'spectrum',
        datasetName: first(parsed.fields, 'TITLE') ?? 'EMSA spectrum',
      })
    },
  })
}

export const emsaReader = createEmsaReader()
