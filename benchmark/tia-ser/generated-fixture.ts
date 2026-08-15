interface GeneratedTiaSerDimension {
  readonly size: number
  readonly offset: number
  readonly delta: number
  readonly element: number
  readonly description: string
  readonly unit: string
}

interface GeneratedTiaSerCalibration {
  readonly offset: number
  readonly delta: number
  readonly element: number
}

interface GeneratedTiaSerTag {
  readonly time: number
  readonly positionX?: number
  readonly positionY?: number
}

interface GeneratedTiaSerElement {
  readonly calibrations: readonly GeneratedTiaSerCalibration[]
  readonly dataType: number
  readonly shape: readonly [number] | readonly [number, number]
  readonly payload: Uint8Array
  readonly tag: GeneratedTiaSerTag
}

export interface GeneratedTiaSerOptions {
  readonly version: 528 | 544
  readonly dataKind: 'spectrum' | 'image'
  readonly tagKind: 'time' | 'position'
  readonly totalElements?: number
  readonly dimensions: readonly GeneratedTiaSerDimension[]
  readonly elements: readonly GeneratedTiaSerElement[]
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const integer = (bytes: 2 | 4 | 8, value: number): Uint8Array => {
  const output = new Uint8Array(bytes)
  const view = new DataView(output.buffer)
  if (bytes === 2) view.setUint16(0, value, true)
  else if (bytes === 4) view.setUint32(0, value, true)
  else view.setBigUint64(0, BigInt(value), true)
  return output
}

const float64 = (value: number): Uint8Array => {
  const output = new Uint8Array(8)
  new DataView(output.buffer).setFloat64(0, value, true)
  return output
}

const calibration = (value: GeneratedTiaSerCalibration): Uint8Array =>
  concat([float64(value.offset), float64(value.delta), integer(4, value.element)])

const dimension = (value: GeneratedTiaSerDimension): Uint8Array => {
  const description = new TextEncoder().encode(value.description)
  const unit = new TextEncoder().encode(value.unit)
  return concat([
    integer(4, value.size),
    float64(value.offset),
    float64(value.delta),
    integer(4, value.element),
    integer(4, description.byteLength),
    description,
    integer(4, unit.byteLength),
    unit,
  ])
}

const dataRecord = (element: GeneratedTiaSerElement): Uint8Array =>
  concat([
    ...element.calibrations.map(calibration),
    integer(2, element.dataType),
    ...element.shape.map((length) => integer(4, length)),
    element.payload,
  ])

const tagRecord = (options: GeneratedTiaSerOptions, tag: GeneratedTiaSerTag): Uint8Array =>
  concat([
    integer(2, options.tagKind === 'position' ? 0x4142 : 0x4152),
    integer(2, 0),
    integer(4, tag.time),
    ...(options.tagKind === 'position'
      ? [float64(tag.positionX ?? 0), float64(tag.positionY ?? 0)]
      : []),
  ])

export const generateTiaSerFixture = (options: GeneratedTiaSerOptions): Uint8Array => {
  const offsetWidth: 4 | 8 = options.version === 528 ? 4 : 8
  const dimensions = options.dimensions.map(dimension)
  const fixedHeaderBytes = options.version === 528 ? 30 : 34
  const offsetArrayOffset =
    fixedHeaderBytes + dimensions.reduce((total, entry) => total + entry.byteLength, 0)
  const records: Uint8Array[] = []
  const dataOffsets: number[] = []
  const tagOffsets: number[] = []
  let recordOffset = offsetArrayOffset + options.elements.length * offsetWidth * 2
  for (const element of options.elements) {
    const data = dataRecord(element)
    const tag = tagRecord(options, element.tag)
    dataOffsets.push(recordOffset)
    records.push(data)
    recordOffset += data.byteLength
    tagOffsets.push(recordOffset)
    records.push(tag)
    recordOffset += tag.byteLength
  }
  return concat([
    integer(2, 0x4949),
    integer(2, 0x0197),
    integer(2, options.version),
    integer(4, options.dataKind === 'spectrum' ? 0x4120 : 0x4122),
    integer(4, options.tagKind === 'position' ? 0x4142 : 0x4152),
    integer(4, options.totalElements ?? options.elements.length),
    integer(4, options.elements.length),
    integer(offsetWidth, offsetArrayOffset),
    integer(4, options.dimensions.length),
    ...dimensions,
    ...dataOffsets.map((offset) => integer(offsetWidth, offset)),
    ...tagOffsets.map((offset) => integer(offsetWidth, offset)),
    ...records,
  ])
}

const int32Payload = (values: readonly number[]): Uint8Array => {
  const output = new Uint8Array(values.length * 4)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setInt32(index * 4, values[index] ?? 0, true)
  }
  return output
}

const uint16Payload = (values: readonly number[]): Uint8Array => {
  const output = new Uint8Array(values.length * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(index * 2, values[index] ?? 0, true)
  }
  return output
}

export const generatedTiaSerPointSpectrum = (): Uint8Array =>
  generateTiaSerFixture({
    version: 528,
    dataKind: 'spectrum',
    tagKind: 'position',
    dimensions: [
      { size: 1, offset: 0, delta: 1, element: 0, description: 'Position', unit: 'meters' },
    ],
    elements: [
      {
        calibrations: [{ offset: 100, delta: 0.5, element: 1 }],
        dataType: 6,
        shape: [4],
        payload: int32Payload([1, -2, 3, 4]),
        tag: { time: 10, positionX: 1, positionY: 2 },
      },
    ],
  })

export const generatedTiaSerSpectrumImage = (): Uint8Array =>
  generateTiaSerFixture({
    version: 544,
    dataKind: 'spectrum',
    tagKind: 'position',
    dimensions: [
      { size: 2, offset: 1, delta: 1, element: 0, description: 'Position', unit: 'meters' },
      { size: 2, offset: 10, delta: 10, element: 0, description: 'Position', unit: 'meters' },
    ],
    elements: Array.from({ length: 4 }, (_, elementIndex) => ({
      calibrations: [{ offset: 100, delta: 0.5, element: 1 }],
      dataType: 2,
      shape: [3] as const,
      payload: uint16Payload([elementIndex * 10 + 1, elementIndex * 10 + 2, elementIndex * 10 + 3]),
      tag: {
        time: 20 + elementIndex,
        positionX: 1 + (elementIndex % 2),
        positionY: 10 + Math.floor(elementIndex / 2) * 10,
      },
    })),
  })

export const generatedTiaSerImageSeries = (): Uint8Array =>
  generateTiaSerFixture({
    version: 528,
    dataKind: 'image',
    tagKind: 'time',
    dimensions: [{ size: 2, offset: 0, delta: 1, element: 0, description: 'Number', unit: '' }],
    elements: [0, 1].map((elementIndex) => {
      const base = elementIndex * 10
      return {
        calibrations: [
          { offset: 0, delta: 0.25, element: 0 },
          { offset: 0, delta: 0.5, element: 0 },
        ],
        dataType: 2,
        shape: [2, 2] as const,
        payload: uint16Payload([base + 3, base + 4, base + 1, base + 2]),
        tag: { time: 30 + elementIndex },
      }
    }),
  })
