import type { ImageCodecAccelerator } from '../../accelerator.ts'
import type { ImageCodec } from '../../codec.ts'
import {
  accelerateWebpCodec,
  type WebpAcceleration,
  type WebpAccelerationRequest,
  type WebpKernel,
} from '../../codecs/webp.ts'
import type {
  Vp8CoefficientReader,
  Vp8lEntropyRequest,
  Vp8Plane,
} from '../../codecs/webp-acceleration.ts'

const abiVersion = 2
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
  | 'vp8-predict'
  | 'vp8-filter'
  | 'vp8-coefficients'
  | 'vp8-rgb-to-yuv420'
  | 'vp8-yuv-to-rgba'
  | 'vp8l-entropy'
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

// Each prediction tile includes the top-left sample, the above-right edge,
// and one left sample per reconstructed row. DataView supports unaligned planes.
const predictionStride = 24
const predictionPlaneBytes = 17 * predictionStride

const copyPredictionBorder = (
  bytes: Uint8Array,
  tile: DataView,
  destination: number,
  plane: Vp8Plane,
  source: DataView,
  offset: number,
  size: number,
): void => {
  const top = offset - plane.stride - 1
  for (let x = 0; x < size + 4; x += 4) {
    tile.setUint32(destination + x, source.getUint32(top + x))
  }
  bytes[destination + size + 4] = plane.data[top + size + 4] ?? 0
  for (let y = 0; y < size; y += 1) {
    bytes[destination + (y + 1) * predictionStride] = plane.data[offset - 1 + y * plane.stride] ?? 0
  }
}

const copyPredictedPixels = (
  tile: DataView,
  source: number,
  plane: DataView,
  offset: number,
  stride: number,
  size: number,
): void => {
  for (let y = 0; y < size; y += 1) {
    const row = source + (y + 1) * predictionStride + 1
    const destination = offset + y * stride
    for (let x = 0; x < size; x += 4) {
      plane.setUint32(destination + x, tile.getUint32(row + x))
    }
  }
}

// Keep the reference decoder's compact root lookups. Rare long codes branch
// through pairs of child entries. A fixed cap bounds setup for complex trees.
const entropyTables = (request: Vp8lEntropyRequest): Uint32Array | undefined => {
  const { groups, distances } = request
  const words: number[] = Array.from(distances)
  const headers = words.length
  words.length += groups.length * 10
  let header = headers
  for (const group of groups) {
    for (const code of [group.green, group.red, group.blue, group.alpha, group.distance]) {
      if (words.length >= 32768) return undefined
      const root = words.length
      words[header++] = root
      words[header++] = code.singleSymbol !== undefined ? 0 : code.lookupBits
      if (code.singleSymbol !== undefined) {
        words.push((code.singleSymbol + 1) << 5)
        continue
      }
      if (words.length + code.lookup.length > 32768) return undefined
      for (const entry of code.lookup) {
        words.push(entry === 0 ? 0 : (((entry >>> 4) + 1) << 5) | (entry & 15))
      }
      for (const [key, symbol] of code.symbols) {
        const length = 31 - Math.clz32(key)
        let slot = root + (key & (code.lookup.length - 1))
        for (let bit = code.lookupBits; bit < length; bit += 1) {
          let entry = words[slot] ?? 0
          if (entry === 0) {
            if (words.length + 2 > 32768) return undefined
            entry = (words.length << 5) | 16
            words[slot] = entry
            words.push(0, 0)
          }
          slot = (entry >>> 5) + ((key >>> bit) & 1)
        }
        words[slot] = ((symbol + 1) << 5) | length
      }
    }
  }
  return Uint32Array.from(words)
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
  const predictTile = numberFunction(instance.exports.webp_predict_tile, 'webp_predict_tile')
  const filterPlane = numberFunction(
    instance.exports.webp_vp8_filter_plane,
    'webp_vp8_filter_plane',
  )
  const entropyBand = numberFunction(
    instance.exports.webp_vp8l_entropy_band,
    'webp_vp8l_entropy_band',
  )
  const decodeCoefficients = numberFunction(
    instance.exports.webp_vp8_coefficients,
    'webp_vp8_coefficients',
  )
  const vp8ToRgba = numberFunction(instance.exports.webp_vp8_yuv_to_rgba, 'webp_vp8_yuv_to_rgba')
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
  let coefficientOwner: object | undefined

  const layout = (sizes: readonly number[]): readonly ScratchRegion[] => {
    coefficientOwner = undefined
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
    vp8FilterRow(
      y: Vp8Plane,
      u: Vp8Plane,
      v: Vp8Plane,
      above: boolean,
      params: Uint8Array,
    ): boolean {
      return attempt('vp8-filter', () => {
        const columns = params.length / 3
        const band = (plane: Vp8Plane, size: number): Uint8Array => {
          const start = plane.origin + (above ? (size - 4) * plane.stride : 0)
          const length = (size + (above ? 4 : 0) - 1) * plane.stride + columns * size
          return plane.data.subarray(start, start + length)
        }
        const planes = [band(y, 16), band(u, 8), band(v, 8)]
        const [cfg, ...regions] = layout([params.byteLength, ...planes.map((p) => p.byteLength)])
        if (!cfg) return false
        const bytes = new Uint8Array(memory.buffer)
        bytes.set(params, cfg.pointer)
        for (let i = 0; i < 3; i++) {
          const plane = planes[i]
          const region = regions[i]
          if (!plane || !region) return false
          bytes.set(plane, region.pointer)
          if (
            filterPlane(
              region.pointer,
              plane.length,
              i === 0 ? y.stride : i === 1 ? u.stride : v.stride,
              i === 0 ? 16 : 8,
              Number(above),
              cfg.pointer,
              columns,
            ) !== 0
          )
            return false
        }
        // Commit all three planes together. The reference can retry an untouched band.
        for (let i = 0; i < 3; i++) {
          const region = regions[i]
          if (region) planes[i]?.set(bytes.subarray(region.pointer, region.pointer + region.bytes))
        }
        return true
      })
    },
    *vp8lEntropy(request: Vp8lEntropyRequest): IterableIterator<Uint32Array> {
      const { input, width, height, historyLength, groups, metaCodes, prefixBits } = request
      if (
        failed ||
        width > 8192 ||
        width * height < 16384 ||
        historyLength > 16384 ||
        historyLength >= width * height ||
        (historyLength & (historyLength - 1)) !== 0 ||
        groups.length > 64
      )
        return
      const tables = entropyTables(request)
      if (!tables) return
      const history = new Uint32Array(historyLength)
      const rowsPerBand = Math.max(1, Math.floor(4096 / width))
      const metaWidth = Math.ceil(width / (1 << prefixBits))
      let bit = request.bitOffset
      let pending = 0
      let distance = 0
      for (let y = 0; y < height; y += rowsPerBand) {
        const rows = Math.min(rowsPerBand, height - y)
        const pixels = rows * width
        const offset = Math.floor(bit / 8)
        // A literal consumes at most 60 bits. A copy needs at most 58 bits.
        const length = Math.min(input.length - offset, pixels * 8 + 8)
        const groupRows = metaCodes?.subarray(
          (y >>> prefixBits) * metaWidth,
          (((y + rows - 1) >>> prefixBits) + 1) * metaWidth,
        )
        let band: Uint32Array | undefined
        const succeeded = attempt('vp8l-entropy', () => {
          const [stream, tree, meta, state] = layout([
            Math.max(1, length),
            tables.byteLength,
            groupRows?.byteLength || 4,
            (3 + historyLength + pixels) * 4,
          ])
          if (!stream || !tree || !meta || !state) return false
          new Uint8Array(memory.buffer, stream.pointer, length).set(
            input.subarray(offset, offset + length),
          )
          copyU32(tree, tables)
          if (groupRows) copyU32(meta, groupRows)
          const words = new Uint32Array(memory.buffer, state.pointer, 3 + historyLength + pixels)
          words[0] = bit % 8
          words[1] = pending
          words[2] = distance
          words.set(history, 3)
          if (
            entropyBand(
              stream.pointer,
              length,
              tree.pointer,
              tables.length,
              meta.pointer,
              groupRows?.length ?? 0,
              state.pointer,
              historyLength,
              width,
              height,
              y,
              rows,
              prefixBits,
            ) !== 0
          )
            return false
          bit = offset * 8 + (words[0] ?? 0)
          pending = words[1] ?? 0
          distance = words[2] ?? 0
          history.set(words.subarray(3, 3 + historyLength))
          band = words.slice(3 + historyLength)
          return true
        })
        if (!succeeded || !band) return
        if (y + rows === height) request.consumeBits(bit - request.bitOffset)
        for (let row = 0; row < rows; row += 1) yield band.subarray(row * width, (row + 1) * width)
      }
    },
    prepareVp8Coefficients(
      data: Uint8Array,
      start: number,
      length: number,
      probabilities: Uint8Array,
    ) {
      // The reference uses a different arithmetic reader for noncanonical partitions.
      if (failed || data[start] === 255 || probabilities.length !== 1056) return undefined
      const end = start + length
      const windowSize = 16_384
      const probabilityPointer = base + windowSize
      const statePointer = probabilityPointer + probabilities.length
      const owner = {}
      let windowStart = 0
      let windowEnd = 0
      let bytes: Uint8Array | undefined
      let words: Uint32Array | undefined
      let leftView: Uint32Array | undefined
      let aboveView: Uint32Array | undefined
      const tile = statePointer + 454 * 4
      const yTile = tile + 16
      const uTile = yTile + predictionPlaneBytes
      const vTile = uTile + predictionPlaneBytes
      let tileView: DataView | undefined
      let yView: DataView | undefined
      let uView: DataView | undefined
      let vView: DataView | undefined
      const reader: Vp8CoefficientReader = {
        predict(
          y,
          u,
          v,
          yOffset,
          uOffset,
          vOffset,
          block,
          rightEdge,
          fallbackCoefficients,
          fallbackEnds,
        ) {
          // decode() has committed the reader and contexts. Original coefficients
          // remain intact during prediction in case the reference must retry.
          if (!bytes || !tileView) throw new Error('Missing WebP WASM coefficient state')
          try {
            yView ??= new DataView(y.data.buffer, y.data.byteOffset, y.data.byteLength)
            uView ??= new DataView(u.data.buffer, u.data.byteOffset, u.data.byteLength)
            vView ??= new DataView(v.data.buffer, v.data.byteOffset, v.data.byteLength)
            bytes.set(block.modes, tile)
            copyPredictionBorder(bytes, tileView, yTile, y, yView, yOffset, 16)
            copyPredictionBorder(bytes, tileView, uTile, u, uView, uOffset, 8)
            copyPredictionBorder(bytes, tileView, vTile, v, vView, vOffset, 8)
            if (
              predictTile(statePointer, tile, block.yMode, block.uvMode, Number(rightEdge)) !== 0
            ) {
              throw new Error('WebP WASM rejected the VP8 predictor')
            }
            diagnostics?.kernelOperation?.('vp8-predict', true)
            copyPredictedPixels(tileView, yTile, yView, yOffset, y.stride, 16)
            copyPredictedPixels(tileView, uTile, uView, uOffset, u.stride, 8)
            copyPredictedPixels(tileView, vTile, vView, vOffset, v.stride, 8)
            return true
          } catch {
            // Refresh views in case the failed call grew linear memory.
            fallbackCoefficients.set(new Int32Array(memory.buffer, statePointer + 54 * 4, 400))
            fallbackEnds.set(new Uint32Array(memory.buffer, statePointer + 29 * 4, 25))
            failed = true
            diagnostics?.kernelOperation?.('vp8-predict', false)
            return false
          }
        },
        range: 255,
        value: ((data[start] ?? 0) << 8) | (data[start + 1] ?? 0),
        bufferedBits: 8,
        offset: start + 2,
        decode(blockMode, factors, left, above) {
          if (failed) return undefined
          try {
            if (bytes?.buffer !== memory.buffer || !words || !leftView || !aboveView) {
              const missing = vTile + predictionPlaneBytes - memory.buffer.byteLength
              if (missing > 0) memory.grow(Math.ceil(missing / wasmPageBytes))
              bytes = new Uint8Array(memory.buffer)
              tileView = new DataView(memory.buffer)
              words = new Uint32Array(memory.buffer, statePointer, 54)
              leftView = words.subarray(11, 20)
              aboveView = words.subarray(20, 29)
            }
            const offset = Math.min(reader.offset, end)
            // 400 coefficients, at most 22 binary decisions each, up to seven
            // normalization bits per decision. 8 KiB covers a whole macroblock.
            if (coefficientOwner !== owner || (windowEnd < end && windowEnd - offset < 8192)) {
              windowStart = offset
              windowEnd = Math.min(windowStart + windowSize, end)
              bytes.set(data.subarray(windowStart, windowEnd), base)
              if (coefficientOwner !== owner) bytes.set(probabilities, probabilityPointer)
              coefficientOwner = owner
            }
            words[0] = reader.range
            words[1] = reader.value
            words[2] = reader.bufferedBits
            words.set(factors.y1, 5)
            words.set(factors.y2, 7)
            words.set(factors.uv, 9)
            leftView.set(left)
            aboveView.set(above)
            if (
              decodeCoefficients(
                base + offset - windowStart,
                windowEnd - offset,
                probabilityPointer,
                statePointer,
                Number(blockMode),
              ) !== 0
            ) {
              throw new Error('WebP WASM rejected the VP8 coefficient block')
            }
            diagnostics?.kernelOperation?.('vp8-coefficients', true)
            reader.range = words[0] ?? 0
            reader.value = words[1] ?? 0
            reader.bufferedBits = words[2] ?? 0
            reader.offset += words[3] ?? 0
            left.set(leftView)
            above.set(aboveView)
            return words[4] !== 0
          } catch {
            failed = true
            diagnostics?.kernelOperation?.('vp8-coefficients', false)
            return undefined
          }
        },
      }
      return reader
    },
    vp8ToRgba(
      y: Uint8Array,
      yStride: number,
      u: Uint8Array,
      uStride: number,
      v: Uint8Array,
      vStride: number,
      width: number,
      height: number,
    ): Uint8Array | undefined {
      let result: Uint8Array | undefined
      const succeeded = attempt('vp8-yuv-to-rgba', () => {
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
          vp8ToRgba(
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
        result = bytes.slice(outputRegion.pointer, outputRegion.pointer + outputBytes)
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
