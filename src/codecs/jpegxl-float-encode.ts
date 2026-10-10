import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import { defaultImageLimits, validateImageDimensions } from '../limits.ts'
import { type PixelBlock, pixelStorage } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { jpegXlPartsByteLength } from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
import {
  acceptsJpegXlColorSemantics,
  encodedJpegXlMetadataBoxes,
  resolveJpegXlEncodeOptions,
} from './jpegxl-modular-encode.ts'
import { encodeJpegXlNative } from './jpegxl-native-encode.ts'

export const acceptsJpegXlFloatColorSemantics = (semantics: PixelColorSemantics): boolean =>
  acceptsJpegXlColorSemantics(semantics) ||
  ((semantics.family === 'gray' || semantics.family === 'rgb') &&
    semantics.transfer.kind === 'source-profile' &&
    semantics.icc !== undefined &&
    semantics.matrix === 'identity' &&
    semantics.range === 'full' &&
    (semantics.alpha === 'none' ||
      semantics.alpha === 'straight' ||
      semantics.alpha === 'premultiplied'))

/** Direct planar staging preserves native samples without an interleaved full-image copy. */
export const createJpegXlFloatEncoder = (sink: ImageSink, request: EncodeRequest): ImageEncoder => {
  throwIfAborted(request.signal)
  const limits = request.limits ?? defaultImageLimits
  validateImageDimensions(request.width, request.height, 1, limits)
  const storage = pixelStorage(request.pixelFormat)
  const floating = storage.sampleType === 'floating-point'
  const gray = storage.channels === 1
  const alpha = storage.channels === 4
  const sampleBytes = storage.bytesPerSample
  if (
    storage.layout !== 'interleaved' ||
    (sampleBytes !== 1 && sampleBytes !== 2 && sampleBytes !== 4) ||
    (floating && sampleBytes !== 4)
  )
    throw unsupportedOperation('JPEG XL native row encoding requires integer or binary32 pixels')
  const channels = alpha ? 4 : gray ? 1 : 3
  const semantics = request.colorSemantics
  const profile = request.metadata?.icc
  const grayProfile =
    !!profile &&
    profile.byteLength >= 128 &&
    profile[16] === 71 &&
    profile[17] === 82 &&
    profile[18] === 65 &&
    profile[19] === 89
  const encodeGray = gray || (alpha && grayProfile)
  const colorCount = encodeGray ? 1 : 3
  const planeCount = colorCount + (alpha ? 1 : 0)
  if (
    !semantics ||
    semantics.family !== (gray ? 'gray' : 'rgb') ||
    (alpha
      ? semantics.alpha !== 'straight' && semantics.alpha !== 'premultiplied'
      : semantics.alpha !== 'none') ||
    (!profile && !acceptsJpegXlColorSemantics(semantics))
  )
    throw unsupportedOperation(
      'JPEG XL native row encoding requires matching structured color or an explicitly preserved ICC profile',
    )
  if (
    profile &&
    (semantics.transfer.kind !== 'source-profile' ||
      !semantics.icc ||
      (semantics.icc.relevance !== 'emitted-pixels' && !(grayProfile && alpha)))
  )
    throw unsupportedOperation(
      'JPEG XL ICC preservation requires samples in the matching source profile',
    )
  const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (!record(request.options)) throw invalidJpegXlInput('encoder options must be an object')
  const options: Readonly<Record<string, unknown>> = request.options
  const { sampleBitDepth, alphaBitDepth, ...otherOptions } = options
  if (
    (sampleBitDepth !== undefined && typeof sampleBitDepth !== 'number') ||
    (alphaBitDepth !== undefined && (typeof alphaBitDepth !== 'number' || !alpha))
  )
    throw invalidJpegXlInput('sample depths must be numeric and alpha depth requires alpha')
  const depth = floating
    ? 32
    : typeof sampleBitDepth === 'number'
      ? sampleBitDepth
      : sampleBytes * 8 === 32
        ? 31
        : sampleBytes * 8
  const alphaDepth = floating ? 32 : typeof alphaBitDepth === 'number' ? alphaBitDepth : depth
  if (
    (floating && sampleBitDepth !== undefined && sampleBitDepth !== 32) ||
    (floating && alphaBitDepth !== undefined && (!alpha || alphaBitDepth !== 32)) ||
    (!floating &&
      (!Number.isSafeInteger(depth) || depth < 1 || depth > Math.min(31, sampleBytes * 8))) ||
    (!floating &&
      alpha &&
      (!Number.isSafeInteger(alphaDepth) ||
        alphaDepth < 1 ||
        alphaDepth > Math.min(31, sampleBytes * 8)))
  )
    throw unsupportedOperation('JPEG XL sample depths do not match the native input storage')
  if (
    (floating || depth > 12 || alphaDepth > 12) &&
    (options.codestreamLevel === 5 || options.container === false)
  )
    throw invalidJpegXlInput('floating or wide integer output requires a Level 10 container')
  const resolved = resolveJpegXlEncodeOptions(
    otherOptions,
    gray ? 'gray16' : alpha ? 'rgba16' : 'rgb16',
    semantics,
    request.width,
    request.height,
  )
  if (resolved.mode !== 'lossless' && !floating)
    throw unsupportedOperation('JPEG XL native integer ICC encoding requires lossless mode')
  if (resolved.progressive)
    throw unsupportedOperation('JPEG XL native float encoding has no VarDCT progressive passes')
  // Lossy Modular float coding rounds a relative mantissa step while retaining IEEE storage.
  const discardedBits =
    resolved.mode === 'lossy'
      ? Math.max(1, Math.min(16, 6 + Math.round(Math.log2(resolved.distance))))
      : 0
  const step = 2 ** discardedBits
  const workingLimit = resolved.maxWorkingBytes ?? limits.maxDecodedBytes
  const outputLimit = resolved.maxOutputBytes ?? 134_217_728
  const inputBytes = BigInt(request.width) * BigInt(request.height) * BigInt(planeCount * 4)
  const metadata = request.metadata ?? {}
  const { icc: _icc, ...otherMetadata } = metadata
  const metadataReserve =
    BigInt(
      (metadata.exif?.byteLength ?? 0) +
        (metadata.xmp?.byteLength ?? 0) +
        (metadata.jumbf?.byteLength ?? 0),
    ) *
      4n +
    128n
  // Native writer's conservative bound includes compressed sections and output assembly.
  const required =
    inputBytes * 13n + BigInt(profile?.byteLength ?? 0) * 10n + metadataReserve + 65536n
  if (required > BigInt(workingLimit) || inputBytes > BigInt(limits.maxDecodedBytes))
    throw limitExceeded('JPEG XL float encoder working storage exceeds its configured limit')
  const boxes = encodedJpegXlMetadataBoxes({ ...request, metadata: otherMetadata }, true)
  const boxBytes = jpegXlPartsByteLength(boxes)
  if (boxBytes + 49 >= outputLimit)
    throw limitExceeded('JPEG XL float output metadata exceeds maxOutputBytes')
  let planes = Array.from(
    { length: planeCount },
    () => new Uint32Array(request.width * request.height),
  )
  let nextY = 0
  let state: 'open' | 'finishing' | 'finished' | 'aborted' = 'open'
  const controller = new AbortController()
  const signal = combineAbortSignals(request.signal, controller.signal)
  const abort = async (reason: unknown): Promise<void> => {
    if (state === 'aborted' || state === 'finished') return
    state = 'aborted'
    controller.abort(reason)
    planes = []
    try {
      await sink.abort(reason)
    } catch {
      /* Preserve the original encoding failure. */
    }
  }
  return {
    async write(block: PixelBlock): Promise<void> {
      if (state !== 'open') throw invalidInput('Cannot write to a closed JPEG XL float encoder')
      try {
        throwIfAborted(signal)
        const rowBytes = request.width * channels * sampleBytes
        if (
          block.x !== 0 ||
          block.y !== nextY ||
          block.width !== request.width ||
          !Number.isSafeInteger(block.height) ||
          block.height < 1 ||
          block.y + block.height > request.height ||
          block.format !== request.pixelFormat ||
          !Number.isSafeInteger(block.stride) ||
          block.stride < rowBytes ||
          block.data.byteLength < block.stride * (block.height - 1) + rowBytes
        )
          throw invalidJpegXlInput('float encoder requires ordered full-width rows')
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        for (let y = 0; y < block.height; y++) {
          throwIfAborted(signal)
          for (let x = 0; x < block.width; x++)
            for (let channel = 0; channel < channels; channel++) {
              const offset = y * block.stride + (x * channels + channel) * sampleBytes
              const bits =
                sampleBytes === 1
                  ? view.getUint8(offset)
                  : sampleBytes === 2
                    ? view.getUint16(offset, false)
                    : view.getUint32(offset, false)
              if (!floating && bits >= 2 ** (channel === 3 ? alphaDepth : depth))
                throw invalidJpegXlInput('integer sample exceeds its declared bit depth')
              if (floating && !Number.isFinite(view.getFloat32(offset, false)))
                throw invalidJpegXlInput('float encoding rejects NaN and infinity')
              if (encodeGray && alpha && (channel === 1 || channel === 2)) {
                if (
                  bits !==
                  (sampleBytes === 1
                    ? view.getUint8(y * block.stride + x * channels * sampleBytes)
                    : sampleBytes === 2
                      ? view.getUint16(y * block.stride + x * channels * sampleBytes, false)
                      : view.getUint32(y * block.stride + x * channels * sampleBytes, false))
                )
                  throw unsupportedOperation(
                    'JPEG XL GRAY ICC float encoding requires equal RGB channels',
                  )
                continue
              }
              const plane = planes[encodeGray && alpha && channel === 3 ? 1 : channel]
              if (!plane) throw invalidJpegXlInput('float plane is missing')
              const sign = bits >= 2 ** 31 ? 2 ** 31 : 0
              const magnitude = bits - sign
              const rounded =
                discardedBits && channel !== 3 ? Math.round(magnitude / step) * step : magnitude
              // Finite maxima round toward infinity; retain that boundary instead.
              plane[(nextY + y) * request.width + x] =
                floating && discardedBits && rounded < 0x7f800000 ? sign + rounded : bits
            }
        }
        nextY += block.height
      } catch (error) {
        await abort(error)
        throw error
      }
    },
    async finish(): Promise<void> {
      if (state !== 'open') throw invalidJpegXlInput('float encoder is already closed')
      state = 'finishing'
      try {
        if (nextY !== request.height)
          throw truncatedInput('JPEG XL float encoder received incomplete rows')
        throwIfAborted(signal)
        const first = planes[0],
          second = planes[1],
          third = planes[2],
          alphaPlane = planes[colorCount]
        if (!first || (!encodeGray && (!second || !third)) || (alpha && !alphaPlane))
          throw invalidJpegXlInput('float color planes are missing')
        const plane = (data: Uint32Array, bitDepth = depth) =>
          ({ data, bitDepth, sampleFormat: floating ? 'binary32' : 'unsigned-integer' }) as const
        const color = encodeGray
          ? ([plane(first)] as const)
          : second && third
            ? ([plane(first), plane(second), plane(third)] as const)
            : undefined
        if (!color) throw invalidJpegXlInput('float color is missing')
        const encoded = await encodeJpegXlNative({
          width: request.width,
          height: request.height,
          color,
          colorSemantics: encodeGray ? { ...semantics, family: 'gray' } : semantics,
          ...(alpha && alphaPlane
            ? {
                extraChannels: [
                  {
                    ...plane(alphaPlane, alphaDepth),
                    type: 0,
                    associatedAlpha: semantics.alpha === 'premultiplied',
                  },
                ],
              }
            : {}),
          ...(profile ? { iccProfile: profile } : {}),
          orientation: resolved.orientation,
          toneMapping: resolved.toneMapping,
          ...(resolved.intrinsicSize ? { intrinsicSize: resolved.intrinsicSize } : {}),
          codestreamLevel:
            floating || depth > 12 || alphaDepth > 12 ? 10 : resolved.codestreamLevel,
          ...(options.container === false ? { container: 'raw' as const } : {}),
          maxOutputBytes: outputLimit - boxBytes,
          limits: {
            ...limits,
            maxDecodedBytes: workingLimit - Number(inputBytes) - Number(metadataReserve),
          },
          ...(signal ? { signal } : {}),
        })
        planes = []
        throwIfAborted(signal)
        await sink.write(encoded)
        for (const box of boxes) {
          throwIfAborted(signal)
          await sink.write(box)
        }
        throwIfAborted(signal)
        state = 'finished'
      } catch (error) {
        await abort(error)
        throw error
      }
    },
    abort,
  }
}
