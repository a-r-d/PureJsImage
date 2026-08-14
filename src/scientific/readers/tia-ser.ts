import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock, RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import type { ImageSource } from '../../source.ts'
import { readExactly } from '../../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisCoordinates,
  ScientificAxisDescriptor,
  ScientificCalibrationEvidence,
  ScientificDataset,
  ScientificPlaneReadRequest,
  ScientificSeriesBlock,
  ScientificSeriesReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
  normalizeScientificSeriesReadRequest,
} from '../dataset.ts'
import type {
  TiaSerCalibration,
  TiaSerDimension,
  TiaSerElement,
  TiaSerIndex,
  TiaSerIndexLimits,
} from '../formats/tia-ser.ts'
import { indexTiaSer } from '../formats/tia-ser.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

export const tiaSerReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/tia-ser',
  version: '1.0.0',
  format: 'FEI/Thermo TIA SER',
  extensions: Object.freeze(['ser']),
  mediaTypes: Object.freeze([
    'application/x-fei-ser',
    'application/x-thermo-tia-ser',
    'application/x-tia-ser',
  ]),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'element-or-compatible-collection',
    axes: 'ranked',
    nativePrecision: true,
    rangeReads: true,
  }),
})

export interface TiaSerReaderLimits extends TiaSerIndexLimits {
  readonly maxSourceBytes: number
  readonly maxDatasets: number
  readonly maxRegionBytes: number
  readonly maxReadOperations: number
  readonly maxInvalidMetadataEntries: number
}

export interface TiaSerReaderOptions {
  readonly limits?: Partial<TiaSerReaderLimits>
}

const defaultLimits: Readonly<TiaSerReaderLimits> = Object.freeze({
  maxSourceBytes: 8_589_934_592,
  maxDimensions: 8,
  maxDimensionLength: 10_000_000,
  maxElements: 262_144,
  maxStringBytes: 65_536,
  maxOffsetArrayBytes: 16_777_216,
  maxElementBytes: 536_870_912,
  maxMetadataBytes: 67_108_864,
  maxDatasets: 4_096,
  maxRegionBytes: 67_108_864,
  maxReadOperations: 262_144,
  maxInvalidMetadataEntries: 256,
})

const positiveLimit = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (
  input: Readonly<Partial<TiaSerReaderLimits>> = {},
): Readonly<TiaSerReaderLimits> =>
  Object.freeze({
    maxSourceBytes: positiveLimit(
      input.maxSourceBytes,
      defaultLimits.maxSourceBytes,
      'TIA SER maxSourceBytes',
    ),
    maxDimensions: positiveLimit(
      input.maxDimensions,
      defaultLimits.maxDimensions,
      'TIA SER maxDimensions',
    ),
    maxDimensionLength: positiveLimit(
      input.maxDimensionLength,
      defaultLimits.maxDimensionLength,
      'TIA SER maxDimensionLength',
    ),
    maxElements: positiveLimit(input.maxElements, defaultLimits.maxElements, 'TIA SER maxElements'),
    maxStringBytes: positiveLimit(
      input.maxStringBytes,
      defaultLimits.maxStringBytes,
      'TIA SER maxStringBytes',
    ),
    maxOffsetArrayBytes: positiveLimit(
      input.maxOffsetArrayBytes,
      defaultLimits.maxOffsetArrayBytes,
      'TIA SER maxOffsetArrayBytes',
    ),
    maxElementBytes: positiveLimit(
      input.maxElementBytes,
      defaultLimits.maxElementBytes,
      'TIA SER maxElementBytes',
    ),
    maxMetadataBytes: positiveLimit(
      input.maxMetadataBytes,
      defaultLimits.maxMetadataBytes,
      'TIA SER maxMetadataBytes',
    ),
    maxDatasets: positiveLimit(input.maxDatasets, defaultLimits.maxDatasets, 'TIA SER maxDatasets'),
    maxRegionBytes: positiveLimit(
      input.maxRegionBytes,
      defaultLimits.maxRegionBytes,
      'TIA SER maxRegionBytes',
    ),
    maxReadOperations: positiveLimit(
      input.maxReadOperations,
      defaultLimits.maxReadOperations,
      'TIA SER maxReadOperations',
    ),
    maxInvalidMetadataEntries: positiveLimit(
      input.maxInvalidMetadataEntries,
      defaultLimits.maxInvalidMetadataEntries,
      'TIA SER maxInvalidMetadataEntries',
    ),
  })

const checkedProduct = (values: readonly number[], label: string): number => {
  let result = 1
  for (const value of values) {
    result *= value
    if (!Number.isSafeInteger(result)) throw limitExceeded(`TIA SER ${label} exceeds safe integers`)
  }
  return result
}

const normalizedUnit = (unit: string | undefined): string | undefined => {
  if (unit === undefined || unit.length === 0) return undefined
  if (unit === 'meters') return 'm'
  if (unit === '1/meters') return '1/m'
  return unit
}

const calibrationEvidence = (
  resourceId: string,
  locator: string,
  note?: string,
): ScientificCalibrationEvidence =>
  Object.freeze({
    kind: 'embedded',
    resourceId,
    locator,
    ...(note === undefined ? {} : { note }),
  })

const coordinatesFromCalibration = (calibration: TiaSerCalibration): ScientificAxisCoordinates => {
  const origin = calibration.offset - calibration.element * calibration.delta
  return Number.isFinite(origin) && Number.isFinite(calibration.delta) && calibration.delta !== 0
    ? Object.freeze({ type: 'linear', origin, step: calibration.delta })
    : Object.freeze({ type: 'index' })
}

const coordinatesFromValues = (values: readonly number[]): ScientificAxisCoordinates => {
  if (values.length < 2) return Object.freeze({ type: 'index' })
  const first = values[0]
  const second = values[1]
  if (first === undefined || second === undefined) return Object.freeze({ type: 'index' })
  const step = second - first
  const tolerance = Math.max(1, Math.abs(first), Math.abs(second), Math.abs(step)) * 1e-12
  if (
    step !== 0 &&
    values.every((value, index) => Math.abs(value - (first + index * step)) <= tolerance)
  ) {
    return Object.freeze({ type: 'linear', origin: first, step })
  }
  return Object.freeze({ type: 'lookup', values: Object.freeze([...values]) })
}

interface NavigationAxisLayout {
  readonly axis: ScientificAxisDescriptor
  readonly dimension: number
  readonly stride: number
}

interface TiaSerDatasetLayout {
  readonly id: string
  readonly name: string
  readonly elements: readonly TiaSerElement[]
  readonly navigationAxes: readonly NavigationAxisLayout[]
  readonly descriptor: NormalizedScientificDatasetDescriptor
}

const sameCalibration = (left: TiaSerCalibration, right: TiaSerCalibration): boolean =>
  Object.is(left.offset, right.offset) &&
  Object.is(left.delta, right.delta) &&
  left.element === right.element

const compatibleElements = (left: TiaSerElement, right: TiaSerElement): boolean =>
  left.sampleType === right.sampleType &&
  left.shape.length === right.shape.length &&
  left.shape.every((length, index) => length === right.shape[index]) &&
  left.calibrations.length === right.calibrations.length &&
  left.calibrations.every((calibration, index) => {
    const candidate = right.calibrations[index]
    return candidate !== undefined && sameCalibration(calibration, candidate)
  })

const allEqual = (values: readonly number[]): boolean => {
  const first = values[0]
  return first !== undefined && values.every((value) => Object.is(value, first))
}

const positionAxes = (
  index: TiaSerIndex,
  elements: readonly TiaSerElement[],
  resourceId: string,
  dataKind: TiaSerIndex['dataKind'],
): readonly NavigationAxisLayout[] | undefined => {
  const dimensions = index.dimensions
  if (
    index.tagKind !== 'position' ||
    (dimensions.length !== 1 && dimensions.length !== 2) ||
    elements.some(
      (element) => element.tag?.positionX === undefined || element.tag.positionY === undefined,
    )
  ) {
    return undefined
  }
  const x = elements.map((element) => element.tag?.positionX ?? Number.NaN)
  const y = elements.map((element) => element.tag?.positionY ?? Number.NaN)
  const axisPrefix = dataKind === 'image' ? 'scan-' : ''
  if (dimensions.length === 1) {
    const dimension = dimensions[0]
    if (dimension === undefined || dimension.size !== elements.length) return undefined
    const xConstant = allEqual(x)
    const yConstant = allEqual(y)
    let id: string
    let name: string
    let values: readonly number[]
    if (!xConstant && yConstant) {
      id = `${axisPrefix}x`
      name = dataKind === 'image' ? 'Scan X' : 'X'
      values = x
    } else if (xConstant && !yConstant) {
      id = `${axisPrefix}y`
      name = dataKind === 'image' ? 'Scan Y' : 'Y'
      values = y
    } else if (!xConstant && !yConstant) {
      id = `${axisPrefix}position`
      name = dataKind === 'image' ? 'Scan position' : 'Position'
      const firstX = x[0] ?? 0
      const firstY = y[0] ?? 0
      values = x.map((value, elementIndex) =>
        Math.hypot(value - firstX, (y[elementIndex] ?? firstY) - firstY),
      )
    } else {
      return undefined
    }
    return Object.freeze([
      Object.freeze({
        dimension: 0,
        stride: 1,
        axis: Object.freeze({
          id,
          name,
          kind: 'space',
          length: dimension.size,
          unit: 'm',
          coordinates: coordinatesFromValues(values),
          calibration: calibrationEvidence(resourceId, 'tia-ser:element-tags:PositionX,PositionY'),
        }),
      }),
    ])
  }

  const firstDimension = dimensions[0]
  const secondDimension = dimensions[1]
  if (
    firstDimension === undefined ||
    secondDimension === undefined ||
    firstDimension.size * secondDimension.size !== elements.length
  ) {
    return undefined
  }
  const xValues = x.slice(0, firstDimension.size)
  const yValues = Array.from(
    { length: secondDimension.size },
    (_, row) => y[row * firstDimension.size] ?? Number.NaN,
  )
  const separable = elements.every((element, elementIndex) => {
    const column = elementIndex % firstDimension.size
    const row = Math.floor(elementIndex / firstDimension.size)
    return (
      Object.is(element.tag?.positionX, xValues[column]) &&
      Object.is(element.tag?.positionY, yValues[row])
    )
  })
  if (!separable) return undefined
  return Object.freeze([
    Object.freeze({
      dimension: 0,
      stride: 1,
      axis: Object.freeze({
        id: `${axisPrefix}x`,
        name: dataKind === 'image' ? 'Scan X' : 'X',
        kind: 'space',
        length: firstDimension.size,
        unit: 'm',
        coordinates: coordinatesFromValues(xValues),
        calibration: calibrationEvidence(resourceId, 'tia-ser:element-tags:PositionX'),
      }),
    }),
    Object.freeze({
      dimension: 1,
      stride: firstDimension.size,
      axis: Object.freeze({
        id: `${axisPrefix}y`,
        name: dataKind === 'image' ? 'Scan Y' : 'Y',
        kind: 'space',
        length: secondDimension.size,
        unit: 'm',
        coordinates: coordinatesFromValues(yValues),
        calibration: calibrationEvidence(resourceId, 'tia-ser:element-tags:PositionY'),
      }),
    }),
  ])
}

const dimensionAxes = (
  dimensions: readonly TiaSerDimension[],
  resourceId: string,
  dataKind: TiaSerIndex['dataKind'],
): readonly NavigationAxisLayout[] => {
  let stride = 1
  const axes: NavigationAxisLayout[] = []
  for (let dimensionIndex = 0; dimensionIndex < dimensions.length; dimensionIndex += 1) {
    const dimension = dimensions[dimensionIndex]
    if (dimension === undefined) continue
    if (dimension.size > 1) {
      const isPosition = dimension.description?.toLowerCase() === 'position'
      const prefix = dataKind === 'image' ? 'scan-' : ''
      const unit = normalizedUnit(dimension.unit)
      const id =
        dimensions.length === 1
          ? isPosition
            ? `${prefix}position`
            : 'element'
          : isPosition && dimensionIndex < 2
            ? `${prefix}${dimensionIndex === 0 ? 'x' : 'y'}`
            : `dimension-${dimensionIndex}`
      const axis: ScientificAxisDescriptor = Object.freeze({
        id,
        name: dimension.description ?? `Dimension ${dimensionIndex}`,
        kind: isPosition ? 'space' : 'other',
        length: dimension.size,
        ...(unit === undefined ? {} : { unit }),
        coordinates: coordinatesFromCalibration(dimension),
        calibration: calibrationEvidence(
          resourceId,
          `tia-ser:header:Dimensions[${dimensionIndex}]`,
        ),
      })
      axes.push(Object.freeze({ dimension: dimensionIndex, stride, axis }))
    }
    stride = checkedProduct([stride, dimension.size], 'navigation stride')
  }
  return Object.freeze(axes)
}

const fallbackElementAxis = (length: number, resourceId: string): readonly NavigationAxisLayout[] =>
  Object.freeze([
    Object.freeze({
      dimension: -1,
      stride: 1,
      axis: Object.freeze({
        id: 'element',
        name: 'Valid element',
        kind: 'other',
        length,
        coordinates: Object.freeze({ type: 'index' }),
        calibration: calibrationEvidence(
          resourceId,
          'tia-ser:header:ValidNumberElements',
          'Declared navigation dimensions did not exactly match the indexed valid elements.',
        ),
      }),
    }),
  ])

const finiteMetadataNumber = (value: number): number | string =>
  Number.isFinite(value) ? value : String(value)

const descriptorForLayout = (
  index: TiaSerIndex,
  elements: readonly TiaSerElement[],
  navigationAxes: readonly NavigationAxisLayout[],
  resourceId: string,
): NormalizedScientificDatasetDescriptor => {
  const first = elements[0]
  if (first === undefined) throw invalidInput('TIA SER dataset has no elements')
  const axes: ScientificAxisDescriptor[] = navigationAxes.map(({ axis }) => axis)
  if (index.dataKind === 'spectrum') {
    const length = first.shape[0]
    const calibration = first.calibrations[0]
    if (length === undefined || calibration === undefined) {
      throw invalidInput('TIA SER spectrum layout is incomplete')
    }
    axes.push(
      Object.freeze({
        id: 'energy',
        name: 'Energy',
        kind: 'spectral',
        length,
        unit: 'eV',
        coordinates: coordinatesFromCalibration(calibration),
        calibration: calibrationEvidence(resourceId, 'tia-ser:element:Calibration[0]'),
      }),
    )
  } else {
    const width = first.shape[0]
    const height = first.shape[1]
    const xCalibration = first.calibrations[0]
    const yCalibration = first.calibrations[1]
    if (
      width === undefined ||
      height === undefined ||
      xCalibration === undefined ||
      yCalibration === undefined
    ) {
      throw invalidInput('TIA SER image layout is incomplete')
    }
    axes.push(
      Object.freeze({
        id: 'x',
        name: 'X',
        kind: 'space',
        length: width,
        unit: 'm',
        coordinates: coordinatesFromCalibration(xCalibration),
        calibration: calibrationEvidence(resourceId, 'tia-ser:element:Calibration[0]'),
      }),
      Object.freeze({
        id: 'y',
        name: 'Y',
        kind: 'space',
        length: height,
        unit: 'm',
        coordinates: coordinatesFromCalibration(yCalibration),
        calibration: calibrationEvidence(resourceId, 'tia-ser:element:Calibration[1]'),
      }),
    )
  }
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes,
    sampleType: first.sampleType,
    components: [{ id: 'intensity', kind: 'intensity' }],
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads:
        index.dataKind === 'spectrum' && navigationAxes.length === 0
          ? { kind: 'none' }
          : index.dataKind === 'spectrum'
            ? { kind: 'any-axis-pair' }
            : { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      ...(index.dataKind === 'spectrum'
        ? { seriesReads: { kind: 'axes', axes: ['energy'] } as const }
        : {}),
    },
    metadata: {
      'purejsimage:tiaSer': {
        seriesVersion: index.version,
        dataKind: index.dataKind,
        firstElement: first.index,
        elementCount: elements.length,
        declaredDimensions: index.dimensions.map((dimension) => ({
          size: dimension.size,
          offset: finiteMetadataNumber(dimension.offset),
          delta: finiteMetadataNumber(dimension.delta),
          calibrationElement: dimension.element,
          ...(dimension.description === undefined ? {} : { description: dimension.description }),
          ...(dimension.unit === undefined ? {} : { unit: dimension.unit }),
        })),
      },
    },
  })
}

const buildLayouts = (
  index: TiaSerIndex,
  resourceId: string,
  maxDatasets: number,
): readonly TiaSerDatasetLayout[] => {
  const first = index.elements[0]
  if (first === undefined) return Object.freeze([])
  const completeCompatibleCollection =
    index.invalidElements.length === 0 &&
    index.elements.length === index.declaredValidElements &&
    index.elements.every((element) => compatibleElements(first, element))
  const declaredProduct = index.dimensions.reduce(
    (product, dimension) => checkedProduct([product, dimension.size], 'dimension product'),
    1,
  )
  if (completeCompatibleCollection) {
    const navigationAxes =
      index.elements.length === 1
        ? Object.freeze([])
        : declaredProduct === index.elements.length
          ? (positionAxes(index, index.elements, resourceId, index.dataKind) ??
            dimensionAxes(index.dimensions, resourceId, index.dataKind))
          : fallbackElementAxis(index.elements.length, resourceId)
    const id = index.dataKind === 'spectrum' ? 'spectra' : 'images'
    const name = index.dataKind === 'spectrum' ? 'TIA spectra' : 'TIA images'
    return Object.freeze([
      Object.freeze({
        id,
        name,
        elements: index.elements,
        navigationAxes,
        descriptor: descriptorForLayout(index, index.elements, navigationAxes, resourceId),
      }),
    ])
  }
  if (index.elements.length > maxDatasets) {
    throw limitExceeded(
      `TIA SER exposes ${index.elements.length} datasets; maxDatasets is ${maxDatasets}`,
    )
  }
  return Object.freeze(
    index.elements.map((element) => {
      const elements = Object.freeze([element])
      const id = `element-${element.index}`
      const name = `${index.dataKind === 'spectrum' ? 'Spectrum' : 'Image'} ${element.index}`
      const navigationAxes = Object.freeze([])
      return Object.freeze({
        id,
        name,
        elements,
        navigationAxes,
        descriptor: descriptorForLayout(index, elements, navigationAxes, resourceId),
      })
    }),
  )
}

const canonicalBytes = (bytes: Uint8Array, bytesPerSample: number): Uint8Array => {
  const output = bytes.slice()
  if (bytesPerSample === 1) return output
  for (let offset = 0; offset < output.byteLength; offset += bytesPerSample) {
    for (let left = 0, right = bytesPerSample - 1; left < right; left += 1, right -= 1) {
      const value = output[left + offset] ?? 0
      output[left + offset] = output[right + offset] ?? 0
      output[right + offset] = value
    }
  }
  return output
}

class TiaSerScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #index: TiaSerIndex
  readonly #layout: TiaSerDatasetLayout
  readonly #limits: TiaSerReaderLimits

  constructor(
    source: ImageSource,
    index: TiaSerIndex,
    layout: TiaSerDatasetLayout,
    limits: TiaSerReaderLimits,
  ) {
    this.#source = source
    this.#index = index
    this.#layout = layout
    this.#limits = limits
    this.descriptor = layout.descriptor
  }

  #elementFor(indices: ReadonlyMap<string, number>): TiaSerElement {
    let logicalIndex = 0
    for (const navigation of this.#layout.navigationAxes) {
      logicalIndex += (indices.get(navigation.axis.id) ?? 0) * navigation.stride
    }
    const element = this.#layout.elements[logicalIndex]
    if (element === undefined) {
      throw invalidInput(`TIA SER selection resolves to missing element ${logicalIndex}`)
    }
    return element
  }

  async #readCanonical(
    offset: number,
    length: number,
    sampleType: RasterSampleType,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const bytes = await readExactly(this.#source, offset, length, {
      ...(signal === undefined ? {} : { signal }),
    })
    return canonicalBytes(bytes, rasterSampleBytes(sampleType))
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    if (this.#index.dataKind === 'spectrum' && this.#layout.navigationAxes.length === 0) {
      throw unsupportedOperation('One-dimensional TIA SER spectra support readSeries(), not planes')
    }
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const bytesPerSample = rasterSampleBytes(this.descriptor.sampleType)
    const outputBytes = checkedProduct(
      [normalized.width, normalized.height, bytesPerSample],
      'selected plane bytes',
    )
    if (outputBytes > this.#limits.maxRegionBytes) {
      throw limitExceeded(
        `TIA SER selected plane requires ${outputBytes} bytes; maxRegionBytes is ${this.#limits.maxRegionBytes}`,
      )
    }
    const reads =
      this.#index.dataKind === 'image' || normalized.displayAxes[0] === 'energy'
        ? normalized.height
        : checkedProduct([normalized.width, normalized.height], 'selected plane reads')
    if (reads > this.#limits.maxReadOperations) {
      throw limitExceeded(
        `TIA SER selected plane requires ${reads} source reads; maxReadOperations is ${this.#limits.maxReadOperations}`,
      )
    }
    const indices = new Map(normalized.fixedIndices.map(({ axisId, index }) => [axisId, index]))
    for (let row = 0; row < normalized.height; row += 1) {
      throwIfAborted(normalized.signal)
      indices.set(normalized.displayAxes[1], normalized.y + row)
      let data: Uint8Array
      if (this.#index.dataKind === 'image') {
        const element = this.#elementFor(indices)
        const width = element.shape[0]
        const height = element.shape[1]
        if (width === undefined || height === undefined) {
          throw invalidInput('TIA SER image element shape is incomplete')
        }
        const sourceY = height - 1 - (normalized.y + row)
        const sourceOffset =
          element.payloadOffset + (sourceY * width + normalized.x) * bytesPerSample
        data = await this.#readCanonical(
          sourceOffset,
          normalized.width * bytesPerSample,
          element.sampleType,
          normalized.signal,
        )
      } else if (normalized.displayAxes[0] === 'energy') {
        const element = this.#elementFor(indices)
        data = await this.#readCanonical(
          element.payloadOffset + normalized.x * bytesPerSample,
          normalized.width * bytesPerSample,
          element.sampleType,
          normalized.signal,
        )
      } else {
        data = new Uint8Array(normalized.width * bytesPerSample)
        const energyIndex = indices.get('energy') ?? 0
        for (let column = 0; column < normalized.width; column += 1) {
          indices.set(normalized.displayAxes[0], normalized.x + column)
          const element = this.#elementFor(indices)
          const sample = await this.#readCanonical(
            element.payloadOffset + energyIndex * bytesPerSample,
            bytesPerSample,
            element.sampleType,
            normalized.signal,
          )
          data.set(sample, column * bytesPerSample)
        }
      }
      yield Object.freeze({
        x: normalized.x,
        y: normalized.y + row,
        width: normalized.width,
        height: 1,
        stride: normalized.width * bytesPerSample,
        format: Object.freeze({
          sampleType: this.descriptor.sampleType,
          channels: 1,
          planar: false,
        }),
        data,
      })
    }
  }

  async *readSeries(
    request: Readonly<ScientificSeriesReadRequest>,
  ): AsyncIterable<ScientificSeriesBlock> {
    if (this.#index.dataKind !== 'spectrum') {
      throw unsupportedOperation('TIA SER image datasets do not expose native series reads')
    }
    const normalized = normalizeScientificSeriesReadRequest(this.descriptor, request)
    if (normalized.axisId !== 'energy') {
      throw unsupportedOperation(`TIA SER supports only energy series, not ${normalized.axisId}`)
    }
    const indices = new Map(normalized.fixedIndices.map(({ axisId, index }) => [axisId, index]))
    const element = this.#elementFor(indices)
    const bytesPerSample = rasterSampleBytes(element.sampleType)
    const maxBlockLength = Math.floor(this.#limits.maxRegionBytes / bytesPerSample)
    if (maxBlockLength < 1) {
      throw limitExceeded(
        `TIA SER ${element.sampleType} samples require ${bytesPerSample} bytes; maxRegionBytes is ${this.#limits.maxRegionBytes}`,
      )
    }
    const reads = Math.ceil(normalized.length / maxBlockLength)
    if (reads > this.#limits.maxReadOperations) {
      throw limitExceeded(
        `TIA SER selected series requires ${reads} source reads; maxReadOperations is ${this.#limits.maxReadOperations}`,
      )
    }
    let start = normalized.start
    const end = normalized.start + normalized.length
    while (start < end) {
      throwIfAborted(normalized.signal)
      const length = Math.min(maxBlockLength, end - start)
      const data = await this.#readCanonical(
        element.payloadOffset + start * bytesPerSample,
        length * bytesPerSample,
        element.sampleType,
        normalized.signal,
      )
      yield Object.freeze({
        start,
        length,
        format: Object.freeze({ sampleType: element.sampleType, channels: 1, planar: false }),
        data,
      })
      start += length
    }
  }
}

const probeBytes = 14

export const createTiaSerReader = (
  options: Readonly<TiaSerReaderOptions> = {},
): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: tiaSerReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const bytes = await context.primary.source.read(0, probeBytes, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      if (bytes.byteLength < probeBytes) {
        return Object.freeze({ confidence: 0, reason: 'TIA SER header is absent' })
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const matches =
        view.getUint16(0, true) === 0x4949 &&
        view.getUint16(2, true) === 0x0197 &&
        (view.getUint16(4, true) === 0x0210 || view.getUint16(4, true) === 0x0220) &&
        (view.getUint32(6, true) === 0x4120 || view.getUint32(6, true) === 0x4122) &&
        (view.getUint32(10, true) === 0x4142 || view.getUint32(10, true) === 0x4152)
      if (!matches) return Object.freeze({ confidence: 0, reason: 'TIA SER signature is absent' })
      const hinted = resourceHasHint(
        context.primary,
        tiaSerReaderDescriptor.extensions,
        tiaSerReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: hinted ? 'TIA SER header and resource hint match' : 'TIA SER header matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      if (context.primary.source.size > limits.maxSourceBytes) {
        throw limitExceeded(
          `TIA SER source has ${context.primary.source.size} bytes; maxSourceBytes is ${limits.maxSourceBytes}`,
        )
      }
      const index = await indexTiaSer(context.primary.source, limits, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      const layouts = buildLayouts(index, context.primary.id, limits.maxDatasets)
      if (layouts.length === 0) {
        const first = index.invalidElements[0]
        throw unsupportedOperation(
          first === undefined
            ? 'TIA SER contains no valid elements'
            : `TIA SER element ${first.index} ${first.reason}`,
        )
      }
      if (layouts.length > limits.maxDatasets) {
        throw limitExceeded(
          `TIA SER exposes ${layouts.length} datasets; maxDatasets is ${limits.maxDatasets}`,
        )
      }
      const entries = await Promise.all(
        layouts.map(async (layout) => {
          const identity = await createScientificDatasetIdentity({
            reader: tiaSerReaderDescriptor,
            datasetId: layout.id,
            resources: [context.primary],
          })
          const dataset = identifyScientificDataset(
            new TiaSerScientificDataset(context.primary.source, index, layout, limits),
            identity,
          )
          return Object.freeze({ layout, identity, dataset })
        }),
      )
      const invalidMetadata = index.invalidElements
        .slice(0, limits.maxInvalidMetadataEntries)
        .map(({ index: elementIndex, reason }) => ({ elementIndex, reason }))
      const tagIssues = index.elements
        .filter((element) => element.tagIssue !== undefined)
        .slice(0, limits.maxInvalidMetadataEntries)
        .map((element) => ({ elementIndex: element.index, reason: element.tagIssue ?? '' }))
      return Object.freeze({
        reader: Object.freeze({
          id: tiaSerReaderDescriptor.id,
          version: tiaSerReaderDescriptor.version,
        }),
        format: tiaSerReaderDescriptor.format,
        metadata: normalizeScientificMetadataObject({
          seriesVersion: index.version,
          dataKind: index.dataKind,
          tagKind: index.tagKind,
          totalElements: index.totalElements,
          declaredValidElements: index.declaredValidElements,
          indexedElements: index.elements.length,
          metadataBytesRead: index.metadataBytesRead,
          invalidElements: invalidMetadata,
          omittedInvalidElements: Math.max(
            0,
            index.invalidElements.length - invalidMetadata.length,
          ),
          tagIssues,
          omittedTagIssues: Math.max(
            0,
            index.elements.filter((element) => element.tagIssue !== undefined).length -
              tagIssues.length,
          ),
        }),
        datasets: Object.freeze(
          entries.map(({ layout, identity, dataset }) =>
            Object.freeze({
              id: layout.id,
              name: layout.name,
              descriptor: dataset.descriptor,
              identity,
            }),
          ),
        ),
        async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          const entry = entries.find(({ layout }) => layout.id === id)
          if (entry === undefined) throw invalidInput(`Unknown TIA SER dataset ${id}`)
          return entry.dataset
        },
      })
    },
  })
}

export const tiaSerReader: ScientificReader = createTiaSerReader()
