export interface WebpKernel {
  readonly simd: boolean

  vp8ToArgb(
    y: Uint8Array,
    yStride: number,
    u: Uint8Array,
    uStride: number,
    v: Uint8Array,
    vStride: number,
    width: number,
    height: number,
  ): Uint32Array | undefined

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
