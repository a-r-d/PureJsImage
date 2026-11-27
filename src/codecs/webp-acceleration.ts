export interface Vp8Plane {
  readonly data: Uint8Array
  readonly stride: number
  readonly origin: number
}

export type HuffmanCode =
  | { readonly singleSymbol: number; readonly maximumSymbol: number }
  | {
      readonly singleSymbol?: undefined
      readonly maximumSymbol: number
      readonly lookup: Uint16Array
      readonly lookupBits: number
      readonly symbols: ReadonlyMap<number, number>
      readonly maximumLength: number
    }

export interface PrefixGroup {
  readonly literalChannels: number | undefined
  readonly green: HuffmanCode
  readonly red: HuffmanCode
  readonly blue: HuffmanCode
  readonly alpha: HuffmanCode
  readonly distance: HuffmanCode
}

export interface Vp8lEntropyRequest {
  readonly input: Uint8Array
  readonly bitOffset: number
  readonly consumeBits: (bits: number) => void
  readonly width: number
  readonly height: number
  readonly historyLength: number
  readonly groups: readonly PrefixGroup[]
  readonly distances: Uint32Array
  readonly metaCodes: Uint32Array | undefined
  readonly prefixBits: number
}

export interface Vp8Factors {
  readonly y1: readonly [number, number]
  readonly y2: readonly [number, number]
  readonly uv: readonly [number, number]
}

export interface Vp8ReaderState {
  range: number
  value: number
  bufferedBits: number
  offset: number
}

export interface Vp8FilteredRow {
  readonly yAbove: Uint8Array
  readonly uAbove: Uint8Array
  readonly vAbove: Uint8Array
  readonly pixels: Uint8Array | undefined
}

export interface Vp8RowRequest {
  readonly width: number
  readonly second: boolean
  readonly simpleFilter: boolean
  readonly recycledPixels: Uint8Array | undefined
  readonly filters: Uint8Array
  readonly filteredY: Uint8Array | undefined
  readonly filteredU: Uint8Array | undefined
  readonly filteredV: Uint8Array | undefined
  readonly reader: Vp8ReaderState
  readonly end: number
  readonly probabilities: Uint8Array
  readonly updateSegments: boolean
  readonly segments: Uint8Array
  readonly skipProbability: number
}

// Y/UV mode, segment, skip, sixteen submodes, nine above contexts, nonzero.
export const vp8RowBlockBytes = 30

export interface Vp8CoefficientReader extends Vp8ReaderState {
  decodeRow(
    planesY: Vp8Plane,
    planesU: Vp8Plane,
    planesV: Vp8Plane,
    first: boolean,
    history: Uint8Array,
    factors: readonly Vp8Factors[],
    request: Vp8RowRequest,
  ): Vp8FilteredRow | undefined
  predict(
    y: Vp8Plane,
    u: Vp8Plane,
    v: Vp8Plane,
    yOffset: number,
    uOffset: number,
    vOffset: number,
    block: { readonly yMode: number; readonly uvMode: number; readonly modes: Int8Array },
    rightEdge: boolean,
    fallbackCoefficients: Int32Array,
    fallbackEnds: Uint8Array,
  ): boolean
  decode(
    blockMode: boolean,
    factors: Vp8Factors,
    left: Int8Array,
    above: Int8Array,
  ): boolean | undefined
}

export interface WebpKernel {
  readonly simd: boolean

  vp8FilterRow(y: Vp8Plane, u: Vp8Plane, v: Vp8Plane, above: boolean, params: Uint8Array): boolean

  vp8lEntropy(request: Vp8lEntropyRequest): Iterable<Uint32Array>

  prepareVp8Coefficients(
    data: Uint8Array,
    start: number,
    length: number,
    probabilities: Uint8Array,
  ): Vp8CoefficientReader | undefined

  vp8ToRgba(
    y: Uint8Array,
    yStride: number,
    u: Uint8Array,
    uStride: number,
    v: Uint8Array,
    vStride: number,
    width: number,
    height: number,
  ): Uint8Array | undefined

  vp8RgbToYuv420(
    input: Uint8Array,
    stride: number,
    width: number,
    height: number,
    channels: 1 | 3 | 4,
    startY: number,
  ): WebpYuvBlock | undefined

  vp8lInversePredictor(
    row: Uint32Array,
    previous: Uint32Array | undefined,
    modes: Uint32Array,
    modeOffset: number,
    modeWidth: number,
    sizeBits: number,
    y: number,
  ): boolean

  vp8lInverseColor(
    row: Uint32Array,
    elements: Uint32Array,
    elementOffset: number,
    elementWidth: number,
    sizeBits: number,
  ): boolean

  vp8lInverseSubtractGreen(row: Uint32Array): boolean

  vp8lInverseRow(
    row: Uint32Array,
    previous: Uint32Array | undefined,
    modes: Uint32Array,
    modeOffset: number,
    modeWidth: number,
    predictorSizeBits: number,
    elements: Uint32Array,
    elementOffset: number,
    elementWidth: number,
    colorSizeBits: number,
    y: number,
    predictorOutput: Uint32Array,
  ): boolean

  vp8lForwardPredictor(
    row: Uint32Array,
    previous: Uint32Array | undefined,
    modes: Uint32Array,
    modeOffset: number,
    modeWidth: number,
    sizeBits: number,
    y: number,
    output: Uint32Array,
  ): boolean

  vp8lForwardColor(
    row: Uint32Array,
    elements: Uint32Array,
    elementOffset: number,
    elementWidth: number,
    sizeBits: number,
  ): boolean

  vp8lForwardSubtractGreen(row: Uint32Array): boolean
}

export interface WebpYuvBlock {
  readonly alpha: Uint8Array | undefined
  readonly chromaStartY: number
  readonly chromaRows: number
  readonly u: Uint16Array
  readonly v: Uint16Array
  readonly y: Uint8Array
}

export interface WebpAccelerationRequest {
  readonly width: number
  readonly height: number
  readonly operation: 'decode' | 'encode'
}

export interface WebpAcceleration {
  prepare(request: WebpAccelerationRequest): Promise<WebpKernel | undefined>
}
