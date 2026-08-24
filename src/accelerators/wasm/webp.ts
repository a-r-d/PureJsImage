import type { ImageCodecAccelerator } from '../../accelerator.ts'
import type { ImageCodec } from '../../codec.ts'
import {
  accelerateWebpCodec,
  type WebpAcceleration,
  type WebpAccelerationRequest,
  type WebpKernel,
} from '../../codecs/webp.ts'

const abiVersion = 1
const wasmPageBytes = 65_536
const defaultMinimumPixels = 16_384
const defaultMinimumEncodePixels = 16_384
const defaultMaximumPixels = 64 * 1024 * 1024

export interface WasmWebpAcceleratorOptions {
  /** Minimum decoded pixel count needed to amortize module loading and bounded row copies. */
  readonly minimumPixels?: number
  /** Minimum encoded pixel count needed to amortize module loading and bounded row copies. */
  readonly minimumEncodePixels?: number
  /** Largest image accepted by the accelerator. The codec still enforces its own limits. */
  readonly maximumPixels?: number
}

export type WasmWebpInstanceLoader = () => Promise<WebAssembly.Instance>

export interface WasmWebpInstanceLoaders {
  readonly decoder?: WasmWebpInstanceLoader
  readonly simdDecoder?: WasmWebpInstanceLoader
  readonly encoder?: WasmWebpInstanceLoader
  readonly simdEncoder?: WasmWebpInstanceLoader
}

export type WasmWebpKernelOperation =
  | 'vp8-rgb-to-yuv420'
  | 'vp8-yuv-to-argb'
  | 'vp8l-forward-color'
  | 'vp8l-forward-predictor'
  | 'vp8l-forward-subtract-green'
  | 'vp8l-inverse-color'
  | 'vp8l-inverse-predictor'
  | 'vp8l-inverse-row'
  | 'vp8l-inverse-subtract-green'

export interface WasmWebpAcceleratorDiagnostics {
  readonly kernelOperation?: (operation: WasmWebpKernelOperation, succeeded: boolean) => void
}

type WasmNumberFunction = (...arguments_: readonly number[]) => number

const numberFunction = (value: unknown, name: string): WasmNumberFunction => {
  if (typeof value !== 'function') throw new Error(`WebP WASM export ${name} is missing`)
  return (...arguments_: readonly number[]): number => {
    const result: unknown = Reflect.apply(value, undefined, arguments_)
    if (typeof result !== 'number') throw new Error(`WebP WASM export ${name} returned no number`)
    return result
  }
}

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`WebP WASM ${name} must be a positive integer`)
  }
  return value
}

const aligned = (value: number): number => Math.ceil(value / 8) * 8

interface ScratchRegion {
  readonly pointer: number
  readonly bytes: number
}

const createKernel = (
  instance: WebAssembly.Instance,
  expectSimd: boolean,
  diagnostics?: WasmWebpAcceleratorDiagnostics,
): WebpKernel => {
  const memoryExport = instance.exports.memory
  if (!(memoryExport instanceof WebAssembly.Memory)) {
    throw new Error('WebP WASM memory export is missing')
  }
  const version = numberFunction(instance.exports.webp_codec_abi_version, 'webp_codec_abi_version')
  const simd = numberFunction(instance.exports.webp_codec_simd, 'webp_codec_simd')
  const vp8ToArgb = numberFunction(instance.exports.webp_vp8_yuv_to_argb, 'webp_vp8_yuv_to_argb')
  const vp8RgbToYuv420 = numberFunction(
    instance.exports.webp_vp8_rgb_to_yuv420,
    'webp_vp8_rgb_to_yuv420',
  )
  const inversePredictor = numberFunction(
    instance.exports.webp_vp8l_inverse_predictor,
    'webp_vp8l_inverse_predictor',
  )
  const inverseRow = numberFunction(instance.exports.webp_vp8l_inverse_row, 'webp_vp8l_inverse_row')
  const forwardPredictor = numberFunction(
    instance.exports.webp_vp8l_forward_predictor,
    'webp_vp8l_forward_predictor',
  )
  const inverseColor = numberFunction(
    instance.exports.webp_vp8l_inverse_color,
    'webp_vp8l_inverse_color',
  )
  const forwardColor = numberFunction(
    instance.exports.webp_vp8l_forward_color,
    'webp_vp8l_forward_color',
  )
  const inverseSubtractGreen = numberFunction(
    instance.exports.webp_vp8l_inverse_subtract_green,
    'webp_vp8l_inverse_subtract_green',
  )
  const forwardSubtractGreen = numberFunction(
    instance.exports.webp_vp8l_forward_subtract_green,
    'webp_vp8l_forward_subtract_green',
  )
  if (version() !== abiVersion) throw new Error('WebP WASM ABI version is unsupported')
  if (simd() !== (expectSimd ? 1 : 0)) {
    throw new Error('WebP WASM SIMD mode does not match its loader')
  }

  const memory = memoryExport
  const base = aligned(memory.buffer.byteLength)
  let failed = false

  const layout = (sizes: readonly number[]): readonly ScratchRegion[] => {
    let pointer = base
    const regions = sizes.map((bytes): ScratchRegion => {
      if (!Number.isSafeInteger(bytes) || bytes < 1)
        throw new Error('Invalid WebP WASM buffer size')
      const region = { pointer, bytes }
      pointer = aligned(pointer + bytes)
      return region
    })
    if (!Number.isSafeInteger(pointer) || pointer > 0xffff_ffff) {
      throw new Error('WebP WASM scratch storage exceeds linear-memory addressing')
    }
    const missing = pointer - memory.buffer.byteLength
    if (missing > 0) memory.grow(Math.ceil(missing / wasmPageBytes))
    return regions
  }

  const attempt = (name: WasmWebpKernelOperation, operation: () => boolean): boolean => {
    if (failed) {
      diagnostics?.kernelOperation?.(name, false)
      return false
    }
    try {
      const succeeded = operation()
      if (!succeeded) failed = true
      diagnostics?.kernelOperation?.(name, succeeded)
      return succeeded
    } catch {
      failed = true
      diagnostics?.kernelOperation?.(name, false)
      return false
    }
  }

  const copyU32 = (region: ScratchRegion, values: Uint32Array): void => {
    new Uint32Array(memory.buffer, region.pointer, values.length).set(values)
  }

  const colorTransform = (
    row: Uint32Array,
    elements: Uint32Array,
    elementOffset: number,
    elementWidth: number,
    sizeBits: number,
    operation: WasmNumberFunction,
  ): boolean =>
    attempt(operation === inverseColor ? 'vp8l-inverse-color' : 'vp8l-forward-color', () => {
      if (
        row.length < 1 ||
        elementWidth < 1 ||
        elementOffset < 0 ||
        elementOffset + elementWidth > elements.length
      ) {
        return false
      }
      const [rowRegion, elementRegion] = layout([row.byteLength, elementWidth * 4])
      if (!rowRegion || !elementRegion) return false
      copyU32(rowRegion, row)
      copyU32(elementRegion, elements.subarray(elementOffset, elementOffset + elementWidth))
      if (
        operation(rowRegion.pointer, row.length, elementRegion.pointer, elementWidth, sizeBits) !==
        0
      ) {
        return false
      }
      row.set(new Uint32Array(memory.buffer, rowRegion.pointer, row.length))
      return true
    })

  const greenTransform = (row: Uint32Array, operation: WasmNumberFunction): boolean =>
    attempt(
      operation === inverseSubtractGreen
        ? 'vp8l-inverse-subtract-green'
        : 'vp8l-forward-subtract-green',
      () => {
        if (row.length < 1) return false
        const [rowRegion] = layout([row.byteLength])
        if (!rowRegion) return false
        copyU32(rowRegion, row)
        if (operation(rowRegion.pointer, row.length) !== 0) return false
        row.set(new Uint32Array(memory.buffer, rowRegion.pointer, row.length))
        return true
      },
    )

  return Object.freeze({
    simd: expectSimd,
    vp8ToArgb(
      y: Uint8Array,
      yStride: number,
      u: Uint8Array,
      uStride: number,
      v: Uint8Array,
      vStride: number,
      width: number,
      height: number,
    ): Uint32Array | undefined {
      let result: Uint32Array | undefined
      const succeeded = attempt('vp8-yuv-to-argb', () => {
        const outputBytes = width * height * 4
        const [yRegion, uRegion, vRegion, outputRegion] = layout([
          y.byteLength,
          u.byteLength,
          v.byteLength,
          outputBytes,
        ])
        if (!yRegion || !uRegion || !vRegion || !outputRegion) return false
        const bytes = new Uint8Array(memory.buffer)
        bytes.set(y, yRegion.pointer)
        bytes.set(u, uRegion.pointer)
        bytes.set(v, vRegion.pointer)
        if (
          vp8ToArgb(
            yRegion.pointer,
            y.byteLength,
            yStride,
            uRegion.pointer,
            u.byteLength,
            uStride,
            vRegion.pointer,
            v.byteLength,
            vStride,
            outputRegion.pointer,
            width * height,
            width,
            height,
          ) !== 0
        ) {
          return false
        }
        result = Uint32Array.from(
          new Uint32Array(memory.buffer, outputRegion.pointer, width * height),
        )
        return true
      })
      return succeeded ? result : undefined
    },
    vp8RgbToYuv420(
      input: Uint8Array,
      stride: number,
      width: number,
      height: number,
      channels: 1 | 3 | 4,
      startY: number,
    ) {
      let result: ReturnType<WebpKernel['vp8RgbToYuv420']>
      const succeeded = attempt('vp8-rgb-to-yuv420', () => {
        const pixels = width * height
        const chromaWidth = Math.ceil(width / 2)
        const chromaStartY = startY >> 1
        const chromaRows = ((startY + height - 1) >> 1) - chromaStartY + 1
        const chromaElements = chromaWidth * chromaRows
        const alphaBytes = channels === 4 ? pixels : 1
        const [inputRegion, yRegion, uRegion, vRegion, alphaRegion] = layout([
          input.byteLength,
          pixels,
          chromaElements * 2,
          chromaElements * 2,
          alphaBytes,
        ])
        if (!inputRegion || !yRegion || !uRegion || !vRegion || !alphaRegion) return false
        new Uint8Array(memory.buffer).set(input, inputRegion.pointer)
        if (
          vp8RgbToYuv420(
            inputRegion.pointer,
            input.byteLength,
            stride,
            yRegion.pointer,
            pixels,
            uRegion.pointer,
            chromaElements,
            vRegion.pointer,
            chromaElements,
            channels === 4 ? alphaRegion.pointer : 0,
            channels === 4 ? pixels : 0,
            width,
            height,
            channels,
            startY,
          ) !== 0
        ) {
          return false
        }
        result = {
          alpha:
            channels === 4
              ? Uint8Array.from(new Uint8Array(memory.buffer, alphaRegion.pointer, pixels))
              : undefined,
          chromaRows,
          chromaStartY,
          u: Uint16Array.from(new Uint16Array(memory.buffer, uRegion.pointer, chromaElements)),
          v: Uint16Array.from(new Uint16Array(memory.buffer, vRegion.pointer, chromaElements)),
          y: Uint8Array.from(new Uint8Array(memory.buffer, yRegion.pointer, pixels)),
        }
        return true
      })
      return succeeded ? result : undefined
    },
    vp8lInversePredictor(
      row: Uint32Array,
      previous: Uint32Array | undefined,
      modes: Uint32Array,
      modeOffset: number,
      modeWidth: number,
      sizeBits: number,
      y: number,
    ): boolean {
      return attempt('vp8l-inverse-predictor', () => {
        if (
          row.length < 1 ||
          (y > 0 && (!previous || previous.length < row.length)) ||
          modeWidth < 1 ||
          modeOffset < 0 ||
          modeOffset + modeWidth > modes.length
        ) {
          return false
        }
        const previousBytes = previous ? row.length * 4 : 4
        const [rowRegion, previousRegion, modesRegion] = layout([
          row.byteLength,
          previousBytes,
          modeWidth * 4,
        ])
        if (!rowRegion || !previousRegion || !modesRegion) return false
        copyU32(rowRegion, row)
        if (previous) copyU32(previousRegion, previous.subarray(0, row.length))
        copyU32(modesRegion, modes.subarray(modeOffset, modeOffset + modeWidth))
        if (
          inversePredictor(
            rowRegion.pointer,
            row.length,
            previous ? previousRegion.pointer : 0,
            previous ? row.length : 0,
            modesRegion.pointer,
            modeWidth,
            sizeBits,
            y,
          ) !== 0
        ) {
          return false
        }
        row.set(new Uint32Array(memory.buffer, rowRegion.pointer, row.length))
        return true
      })
    },
    vp8lInverseColor(
      row: Uint32Array,
      elements: Uint32Array,
      elementOffset: number,
      elementWidth: number,
      sizeBits: number,
    ): boolean {
      return colorTransform(row, elements, elementOffset, elementWidth, sizeBits, inverseColor)
    },
    vp8lInverseSubtractGreen(row: Uint32Array): boolean {
      return greenTransform(row, inverseSubtractGreen)
    },
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
    ): boolean {
      return attempt('vp8l-inverse-row', () => {
        if (
          row.length < 1 ||
          predictorOutput.length < row.length ||
          (y > 0 && (!previous || previous.length < row.length)) ||
          modeWidth < 1 ||
          modeOffset < 0 ||
          modeOffset + modeWidth > modes.length ||
          elementWidth < 1 ||
          elementOffset < 0 ||
          elementOffset + elementWidth > elements.length
        ) {
          return false
        }
        const [rowRegion, previousRegion, modesRegion, elementsRegion] = layout([
          row.byteLength,
          row.byteLength,
          modeWidth * 4,
          elementWidth * 4,
        ])
        if (!rowRegion || !previousRegion || !modesRegion || !elementsRegion) return false
        copyU32(rowRegion, row)
        if (previous) copyU32(previousRegion, previous.subarray(0, row.length))
        copyU32(modesRegion, modes.subarray(modeOffset, modeOffset + modeWidth))
        copyU32(elementsRegion, elements.subarray(elementOffset, elementOffset + elementWidth))
        if (
          inverseRow(
            rowRegion.pointer,
            row.length,
            previousRegion.pointer,
            previous ? row.length : 0,
            modesRegion.pointer,
            modeWidth,
            predictorSizeBits,
            elementsRegion.pointer,
            elementWidth,
            colorSizeBits,
            y,
          ) !== 0
        ) {
          return false
        }
        predictorOutput.set(new Uint32Array(memory.buffer, previousRegion.pointer, row.length), 0)
        row.set(new Uint32Array(memory.buffer, rowRegion.pointer, row.length))
        return true
      })
    },
    vp8lForwardPredictor(
      row: Uint32Array,
      previous: Uint32Array | undefined,
      modes: Uint32Array,
      modeOffset: number,
      modeWidth: number,
      sizeBits: number,
      y: number,
      output: Uint32Array,
    ): boolean {
      return attempt('vp8l-forward-predictor', () => {
        if (
          row.length < 1 ||
          output.length < row.length ||
          (y > 0 && (!previous || previous.length < row.length)) ||
          modeWidth < 1 ||
          modeOffset < 0 ||
          modeOffset + modeWidth > modes.length
        ) {
          return false
        }
        const previousBytes = previous ? row.length * 4 : 4
        const [rowRegion, previousRegion, modesRegion, outputRegion] = layout([
          row.byteLength,
          previousBytes,
          modeWidth * 4,
          row.byteLength,
        ])
        if (!rowRegion || !previousRegion || !modesRegion || !outputRegion) return false
        copyU32(rowRegion, row)
        if (previous) copyU32(previousRegion, previous.subarray(0, row.length))
        copyU32(modesRegion, modes.subarray(modeOffset, modeOffset + modeWidth))
        if (
          forwardPredictor(
            rowRegion.pointer,
            row.length,
            previous ? previousRegion.pointer : 0,
            previous ? row.length : 0,
            modesRegion.pointer,
            modeWidth,
            outputRegion.pointer,
            row.length,
            sizeBits,
            y,
          ) !== 0
        ) {
          return false
        }
        output.set(new Uint32Array(memory.buffer, outputRegion.pointer, row.length))
        return true
      })
    },
    vp8lForwardColor(
      row: Uint32Array,
      elements: Uint32Array,
      elementOffset: number,
      elementWidth: number,
      sizeBits: number,
    ): boolean {
      return colorTransform(row, elements, elementOffset, elementWidth, sizeBits, forwardColor)
    },
    vp8lForwardSubtractGreen(row: Uint32Array): boolean {
      return greenTransform(row, forwardSubtractGreen)
    },
  })
}

const loadKernel = async (
  scalar: WasmWebpInstanceLoader | undefined,
  simd: WasmWebpInstanceLoader | undefined,
  diagnostics?: WasmWebpAcceleratorDiagnostics,
): Promise<WebpKernel | undefined> => {
  if (simd) {
    try {
      return createKernel(await simd(), true, diagnostics)
    } catch {
      if (!scalar) return undefined
    }
  }
  if (!scalar) return undefined
  try {
    return createKernel(await scalar(), false, diagnostics)
  } catch {
    return undefined
  }
}

export const createWasmWebpAcceleratorWithLoaders = (
  loaders: WasmWebpInstanceLoaders,
  options: WasmWebpAcceleratorOptions = {},
  diagnostics?: WasmWebpAcceleratorDiagnostics,
): ImageCodecAccelerator => {
  const minimumPixels = positiveInteger(
    'minimumPixels',
    options.minimumPixels ?? defaultMinimumPixels,
  )
  const minimumEncodePixels = positiveInteger(
    'minimumEncodePixels',
    options.minimumEncodePixels ?? defaultMinimumEncodePixels,
  )
  const maximumPixels = positiveInteger(
    'maximumPixels',
    options.maximumPixels ?? defaultMaximumPixels,
  )
  let decoderPromise: Promise<WebpKernel | undefined> | undefined
  let encoderPromise: Promise<WebpKernel | undefined> | undefined

  const acceleration: WebpAcceleration = {
    async prepare(request: WebpAccelerationRequest): Promise<WebpKernel | undefined> {
      const pixels = BigInt(request.width) * BigInt(request.height)
      const minimum = request.operation === 'decode' ? minimumPixels : minimumEncodePixels
      if (
        typeof WebAssembly !== 'object' ||
        pixels < BigInt(minimum) ||
        pixels > BigInt(maximumPixels)
      ) {
        return undefined
      }
      if (request.operation === 'decode') {
        if (!loaders.decoder && !loaders.simdDecoder) return undefined
        decoderPromise ??= loadKernel(loaders.decoder, loaders.simdDecoder, diagnostics)
        return decoderPromise
      }
      if (!loaders.encoder && !loaders.simdEncoder) return undefined
      encoderPromise ??= loadKernel(loaders.encoder, loaders.simdEncoder, diagnostics)
      return encoderPromise
    },
  }

  return Object.freeze({
    format: 'webp',
    id: 'rust-wasm-webp',
    kind: 'wasm',
    accelerate(reference: ImageCodec): ImageCodec {
      return accelerateWebpCodec(reference, acceleration)
    },
  })
}

export const createWasmWebpAcceleratorWithLoader = (
  loadInstance: WasmWebpInstanceLoader,
  options: WasmWebpAcceleratorOptions = {},
): ImageCodecAccelerator =>
  createWasmWebpAcceleratorWithLoaders({ decoder: loadInstance, encoder: loadInstance }, options)
