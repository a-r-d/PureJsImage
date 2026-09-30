import {
  BlobSource,
  createImageLibrary,
  defaultImageLimits,
  type PixelColorSemantics,
} from '../../../src/browser.ts'
import { jpegCodec } from '../../../src/codecs/jpeg.ts'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../../src/codecs/png.ts'
import { tiffCodec } from '../../../src/codecs/tiff.ts'
import {
  encodeJpegXlAnimation,
  encodeJpegXlNative,
  inspectJpegXl,
  type JpegXlNativeExtraInput,
  type JpegXlNativePlaneInput,
  jpegXlNativeUnsignedPlanes,
  openJpegXlSequence,
  openJpegXlSession,
} from '../../../src/jpegxl.ts'
import type { ImageSource } from '../../../src/source.ts'
import {
  imageSourceIdentity,
  inheritImageSourceIdentity,
} from '../../../src/source-identity-contract.ts'
import { HttpRangeSource } from '../../../src/sources/http-range.ts'
import { type JxlToolRequest, type JxlToolResponse, option } from './jpegxl-tool-types.ts'
import { channelCount, nativePixels } from './jpegxl-workbench-pixels.ts'

const limits = {
  ...defaultImageLimits,
  maxInputBytes: 67108864,
  maxPixels: 4194304,
  maxDecodedBytes: 268435456,
}
const srgb: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'straight',
  provenance: 'container-signaled',
  renderingIntent: 'relative',
}
const images = createImageLibrary([jpegxlCodec, pngCodec, jpegCodec, tiffCodec])
const buffer = (data: Uint8Array | Uint8ClampedArray) => {
  const bytes = new ArrayBuffer(data.byteLength)
  new Uint8Array(bytes).set(data)
  return bytes
}
function checkFile(file: File | undefined): File {
  if (!file || file.size > limits.maxInputBytes)
    throw new Error('Choose a file no larger than 64 MiB')
  return file
}
const integer = (
  o: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const v = option(o, key, fallback, min, max)
  if (!Number.isInteger(v)) throw new Error(`${key} must be an integer`)
  return v
}
function pixelBuffer(width: number, height: number): Uint8ClampedArray {
  if (width * height > 4194304)
    throw new Error('Preview exceeds 4 megapixels. Increase scale or reduce viewport.')
  return new Uint8ClampedArray(width * height * 4)
}
async function png(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const planes = Array.from({ length: 4 }, () => new Uint8Array(width * height))
  for (let c = 0; c < 4; c++) {
    const plane = planes[c]
    if (!plane) throw new Error('Missing display plane')
    for (let i = 0; i < plane.length; i++) plane[i] = rgba[i * 4 + c] ?? 0
  }
  const r = planes[0],
    g = planes[1],
    b = planes[2],
    a = planes[3]
  if (!r || !g || !b || !a) throw new Error('Missing display channels')
  const native = await encodeJpegXlNative({
    width,
    height,
    color: [
      { data: r, bitDepth: 8 },
      { data: g, bitDepth: 8 },
      { data: b, bitDepth: 8 },
    ],
    extraChannels: [{ type: 0, data: a, bitDepth: 8 }],
    colorSemantics: srgb,
    signal,
    limits,
  })
  return (await images.open(native, { signal, limits })).png().toUint8Array({ signal })
}

export async function runJxlTool(
  request: JxlToolRequest,
  signal: AbortSignal,
  emit: (response: JxlToolResponse) => void,
): Promise<void> {
  const send = (
    state: JxlToolResponse['state'],
    message: string,
    info: Record<string, unknown>,
    image?: JxlToolResponse['image'],
    bytes?: Uint8Array,
    name?: string,
  ) => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    emit({
      type: 'tool-event',
      generation: request.generation,
      requestId: request.requestId,
      state,
      message,
      info,
      ...(image ? { image } : {}),
      ...(bytes ? { bytes: buffer(bytes), name: name ?? 'output.bin' } : {}),
    })
  }
  if (request.tool === 'progressive') {
    let remote: HttpRangeSource | undefined
    let rangeFailure: string | undefined
    const url = request.url ? new URL(request.url) : undefined
    if (url && !['https:', 'http:'].includes(url.protocol))
      throw new Error('Use an explicit HTTP or HTTPS URL')
    const source = request.file
      ? new BlobSource(checkFile(request.file))
      : url
        ? await HttpRangeSource.open(url, {
            openSignal: signal,
            blockBytes: 4096,
            maxCacheBytes: 1048576,
            fetch: async (resource, init) => {
              const response = await fetch(resource, {
                ...init,
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
              })
              if (response.status === 200 && new Headers(init?.headers).has('Range')) {
                await response.body?.cancel()
                rangeFailure =
                  'Server returned the full file instead of a byte range. Download it and use local-file mode.'
                throw new Error(
                  'Server returned the full file instead of a byte range. Download it and use local-file mode; no unbounded network fallback is used.',
                )
              }
              return response
            },
          }).catch((error: unknown) => {
            throw new Error(
              rangeFailure ??
                `Could not open HTTP Range source. Check CORS, exposed Content-Range and server byte-range support. ${error instanceof Error ? error.message : String(error)}`,
            )
          })
        : undefined
    if (source instanceof HttpRangeSource) remote = source
    if (!source)
      throw new Error(
        'Choose a file, sample or explicit Range URL. Cross-origin URLs must allow CORS and expose Content-Range.',
      )
    if (source.size > limits.maxInputBytes) throw new Error('Source exceeds the 64 MiB tool limit')
    let logical = 0,
      read = 0
    const ranges = new Uint32Array(256)
    const observed: ImageSource = {
      size: source.size,
      [imageSourceIdentity]: () => inheritImageSourceIdentity(source),
      async read(offset, length, options) {
        logical += length
        const bytes = await source.read(offset, length, options)
        read += bytes.length
        for (
          let i = Math.floor((offset / source.size) * 256);
          i <= Math.min(255, Math.floor(((offset + bytes.length - 1) / source.size) * 256));
          i++
        )
          ranges[i] = (ranges[i] ?? 0) + 1
        return bytes
      },
    }
    const started = performance.now()
    const session = await openJpegXlSession(observed, { limits, maxCachedBytes: 16777216, signal })
    try {
      send('opened', 'Session opened. Reading requested stages…', {
        width: session.width,
        height: session.height,
      })
      const scale = integer(request.options, 'scale', 8, 1, 8)
      if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8)
        throw new Error('Scale must be 1, 2, 4 or 8')
      const zoom = integer(request.options, 'zoom', 4, 1, 16)
      const dw = session.orientation >= 5 ? session.height : session.width,
        dh = session.orientation >= 5 ? session.width : session.height
      const width = Math.max(1, Math.floor(dw / zoom)),
        height = Math.max(1, Math.floor(dh / zoom))
      const region = {
        width,
        height,
        x: Math.floor(((dw - width) * option(request.options, 'x', 50, 0, 100)) / 100),
        y: Math.floor(((dh - height) * option(request.options, 'y', 50, 0, 100)) / 100),
      }
      const q = {
        signal,
        coordinateSpace: 'display' as const,
        scaleDenominator: scale as 1 | 2 | 4 | 8,
        ...(request.action === 'viewport' ? { region } : {}),
      }
      let rgba: Uint8ClampedArray = new Uint8ClampedArray(),
        w = 0,
        h = 0,
        firstPixelMs: number | undefined
      for await (const event of request.action === 'native'
        ? session.native(q)
        : session.progressive(q)) {
        if (event.type === 'stage-start') {
          w = event.stage.width
          h = event.stage.height
          rgba = pixelBuffer(w, h)
        } else if (event.type === 'block') {
          const b = event.block
          try {
            if (
              !['rgb8', 'rgba8', 'gray8'].includes(b.format) ||
              b.colorSemantics?.transfer.kind !== 'srgb' ||
              b.colorSemantics?.primaries !== 'srgb'
            )
              throw new Error(
                'Progressive canvas supports sRGB8 stages. Inspect this source in Native samples for explicit display conversion.',
              )
            const channels = b.format === 'gray8' ? 1 : b.format === 'rgb8' ? 3 : 4
            for (let y = 0; y < b.height; y++)
              for (let x = 0; x < b.width; x++) {
                const a = y * b.stride + x * channels,
                  t = ((b.y + y) * w + b.x + x) * 4
                rgba[t] = b.data[a] ?? 0
                rgba[t + 1] = b.data[a + (channels === 1 ? 0 : 1)] ?? 0
                rgba[t + 2] = b.data[a + (channels === 1 ? 0 : 2)] ?? 0
                rgba[t + 3] = channels === 4 ? (b.data[a + 3] ?? 0) : 255
              }
            firstPixelMs ??= performance.now() - started
          } finally {
            b.release?.()
          }
        } else if (event.type === 'stage-complete') {
          send(
            'stage',
            `${event.stage.kind} complete`,
            {
              stage: event.stage.kind,
              completedPasses: event.stage.completedPasses,
              sourceBytes: source.size,
              logicalRequestedBytes: logical,
              sourceReadBytes: read,
              httpTransferBytes: remote?.stats.transferBytes ?? null,
              sourceCacheBytes: remote?.stats.cacheBytes ?? 0,
              managedPeakBytes: session.managedPeakBytes,
              canvasBytes: rgba.byteLength,
              browserProcessMemory: null,
              firstPixelMs,
              elapsedMs: performance.now() - started,
              ranges: Array.from(ranges),
              fullFrameFallback: event.stage.plan.fullFrameFallback,
              fallbackReasons: event.stage.plan.fallbackReasons,
              workingMemoryClass: event.stage.plan.workingMemoryClass,
              groups: event.stage.plan.groupIds,
            },
            { width: w, height: h, rgba: buffer(rgba) },
          )
          // Yield in the worker so cancellation can interrupt between complete stages.
          await new Promise<void>((resolve) => setTimeout(resolve, 16))
        }
      }
      send('done', 'Progressive operation complete. Every run opens a fresh bounded session.', {})
    } finally {
      await session.close()
    }
    return
  }
  if (request.tool === 'animation' && request.action === 'encode') {
    const files = request.files
    if (!files?.length || files.length > 16 || files.reduce((n, f) => n + f.size, 0) > 67108864)
      throw new Error('Choose 1–16 frames with at most 64 MiB total input')
    const duration = integer(request.options, 'duration', 100, 1, 60000),
      loops = integer(request.options, 'loops', 0, 0, 1000)
    let width = 0,
      height = 0,
      totalPixels = 0
    const frames: { width: number; height: number; data: Uint8Array; durationTicks: number }[] = []
    for (const file of files) {
      const image = await images.open(checkFile(file), { signal, limits }),
        metadata = await image.metadata()
      if ((metadata.bitDepth ?? 8) !== 8)
        throw new Error(
          'Animation creation accepts 8-bit frames. Native higher-depth files remain inspectable in Native samples.',
        )
      if (metadata.width * metadata.height > 1048576)
        throw new Error('Each creation frame is limited to one megapixel')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const codec = [pngCodec, jpegCodec, tiffCodec, jpegxlCodec].find((c) => c.detect(bytes))
      if (!codec) throw new Error('Unsupported frame file')
      const native = await nativePixels(codec, bytes, signal)
      if (native.format.endsWith('16')) throw new Error('Creation accepts 8-bit frames')
      const color = native.decoder.colorSemantics
      if (color && (color.transfer.kind !== 'srgb' || color.primaries !== 'srgb'))
        throw new Error('Creation requires sRGB frames')
      const result = new Uint8Array(native.width * native.height * 4),
        channels = channelCount(native.format)
      for (let i = 0; i < native.width * native.height; i++) {
        const a = i * channels
        result.set(
          [
            native.pixels[a] ?? 0,
            native.pixels[a + (channels === 1 ? 0 : 1)] ?? 0,
            native.pixels[a + (channels === 1 ? 0 : 2)] ?? 0,
            channels === 4 ? (native.pixels[a + 3] ?? 0) : 255,
          ],
          i * 4,
        )
      }
      if (!frames.length) {
        width = metadata.width
        height = metadata.height
      }
      if (
        metadata.width !== width ||
        metadata.height !== height ||
        (metadata.orientation ?? 1) !== 1
      )
        throw new Error('Creation frames must have matching stored dimensions and orientation 1')
      totalPixels += width * height
      if (totalPixels > 8388608)
        throw new Error('Creation is limited to eight million total frame pixels')
      frames.push({ width, height, data: result, durationTicks: duration })
    }
    async function* input() {
      yield* frames
    }
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of encodeJpegXlAnimation(input(), {
      width,
      height,
      pixelFormat: 'rgba8',
      colorSemantics: srgb,
      animation: {
        ticksPerSecondNumerator: 1000,
        ticksPerSecondDenominator: 1,
        loops,
        haveTimecodes: false,
      },
      encoding:
        request.options.lossy === true
          ? { mode: 'lossy', distance: option(request.options, 'distance', 1, 0.25, 25), effort: 1 }
          : { mode: 'lossless', effort: 1 },
      signal,
      limits,
      maxOutputBytes: 67108864,
      maxEncodedPixels: 8388608,
    })) {
      size += chunk.length
      if (size > 67108864) throw new Error('Encoded animation exceeds limit')
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const c of chunks) {
      bytes.set(c, offset)
      offset += c.length
    }
    send(
      'output',
      'Animation encoded. Reopen it to verify timing and inspect frames.',
      {
        frames: frames.length,
        width,
        height,
        durationTicks: duration,
        ticksPerSecond: '1000/1',
        loops,
        mode:
          request.options.lossy === true ? 'Experimental lossy animation' : 'Lossless animation',
      },
      undefined,
      bytes,
      'animation.jxl',
    )
    return
  }
  const file = checkFile(request.file),
    source = new BlobSource(file)
  const sequence = await openJpegXlSequence(source, {
    signal,
    limits,
    maxDecodedPixels: 4194304,
    orientation: 'preserve',
  })
  try {
    if (request.tool === 'animation') {
      const headers = []
      for await (const header of sequence.headers(signal)) {
        if (headers.length >= 128) throw new Error('Playback supports at most 128 encoded frames')
        if (header.duration !== undefined && (header.duration > 0 || header.isLast))
          headers.push(header)
      }
      if (!headers.length) throw new Error('This file has no timed animation frames')
      const index = integer(request.options, 'frame', 0, 0, headers.length - 1),
        frame = await sequence.frame(index, signal)
      if (
        frame.colorSemantics.transfer.kind !== 'srgb' ||
        frame.colorSemantics.primaries !== 'srgb'
      )
        throw new Error(
          'Animation canvas currently requires sRGB frames; native color is not silently converted',
        )
      const rgba = pixelBuffer(frame.width, frame.height),
        colors = frame.header.colorChannels,
        alpha = frame.header.selectedAlphaChannel
      for (let i = 0; i < frame.width * frame.height; i++) {
        for (let c = 0; c < 3; c++)
          rgba[i * 4 + c] = Math.round((frame.planes[colors === 1 ? 0 : c]?.[i] ?? 0) * 255)
        const opacity = alpha === undefined ? 1 : (frame.planes[colors + alpha]?.[i] ?? 0)
        rgba[i * 4 + 3] = Math.round(opacity * 255)
        if (frame.header.alphaAssociated)
          for (let c = 0; c < 3; c++)
            rgba[i * 4 + c] =
              opacity > 0
                ? Math.round(((frame.planes[colors === 1 ? 0 : c]?.[i] ?? 0) / opacity) * 255)
                : 0
      }
      const info = {
        frame: index,
        frameCount: headers.length,
        frames: headers.map((h, i) => ({ index: i, durationTicks: h.duration ?? 0 })),
        animation: frame.header.animation,
        startTicks: frame.startTicks,
        durationTicks: frame.durationTicks,
        width: frame.width,
        height: frame.height,
        replay:
          'Selected frames replay dependencies from the start. Only the selected display is retained.',
      }
      if (request.action === 'export')
        send(
          'output',
          'Selected frame exported as sRGB8 PNG.',
          info,
          { width: frame.width, height: frame.height, rgba: buffer(rgba) },
          await png(rgba, frame.width, frame.height, signal),
          `frame-${index}.png`,
        )
      else
        send('done', `Frame ${index + 1} of ${headers.length}`, info, {
          width: frame.width,
          height: frame.height,
          rgba: buffer(rgba),
        })
      return
    }
    const iterator = sequence.layers(signal)[Symbol.asyncIterator](),
      first = await iterator.next()
    if (first.done) throw new Error('No native layer')
    const layer = first.value
    await iterator.return?.(undefined)
    if (layer.domain !== 'modular')
      throw new Error(
        'This image has reconstructed XYB planes. The native tool currently inspects Modular integer/float layers; use Convert for its display.',
      )
    const planes = jpegXlNativeUnsignedPlanes(layer),
      h = layer.header
    const selected = integer(request.options, 'plane', 0, 0, planes.length - 1),
      layout = layer.layouts[selected],
      plane = planes[selected]
    if (!layout || !plane) throw new Error('Missing sample plane')
    const extra =
      selected >= h.colorChannels ? h.extraChannels[selected - h.colorChannels] : undefined
    const depth = extra?.bitDepth.bits ?? h.bitDepth,
      exponent = extra?.bitDepth.exponentBits ?? h.exponentBits
    const white = option(
      request.options,
      'white',
      exponent ? 1 : 2 ** depth - 1,
      0.000001,
      4294967295,
    )
    const x = integer(request.options, 'sampleX', 0, 0, layout.width - 1),
      y = integer(request.options, 'sampleY', 0, 0, layout.height - 1)
    const rgba = pixelBuffer(layout.width, layout.height)
    const float = exponent === 8 && depth === 32 ? new Float32Array(plane.buffer) : undefined
    if (exponent && !float)
      throw new Error(
        'Numeric display currently supports integers and IEEE binary32. Other native bit patterns are not converted.',
      )
    for (let i = 0; i < plane.length; i++) {
      const v = (float?.[i] ?? plane[i] ?? 0) / white
      const sample = Number.isFinite(v) ? Math.round(Math.max(0, Math.min(1, v)) * 255) : 0
      rgba.set([sample, sample, sample, 255], i * 4)
    }
    const inspection = await inspectJpegXl(source, { signal, limits })
    const info = {
      toneMapping: h.toneMapping,
      chromaticities: h.chromaticities,
      width: h.width,
      height: h.height,
      orientation: h.orientation,
      domain: layer.domain,
      bitDepth: h.bitDepth,
      exponentBits: h.exponentBits,
      sampleFormat: h.sampleFormat,
      color: h.metadataColorSpace,
      primaries: h.colorSemanticsPrimaries,
      transfer: h.colorSemanticsTransfer,
      iccBytes: h.iccProfile?.length ?? 0,
      alphaAssociated: h.alphaAssociated,
      extraChannels: h.extraChannels,
      planes: planes.map((p, i) => ({
        index: i,
        name:
          i < h.colorChannels
            ? `Color ${i}`
            : h.extraChannels[i - h.colorChannels]?.name || `Extra ${i - h.colorChannels}`,
        layout: layer.layouts[i],
        samples: p.length,
      })),
      selectedPlane: selected,
      sample: {
        x,
        y,
        value: float?.[y * layout.width + x] ?? plane[y * layout.width + x],
        rawBits: `0x${(plane[y * layout.width + x] ?? 0).toString(16)}`,
      },
      mapping: { black: 0, white, kind: 'explicit scalar plane mapping, no color conversion' },
      nativeReencode:
        'Native Modular samples only. Unsupported metadata/profile combinations fail explicitly.',
    }
    const image = { width: layout.width, height: layout.height, rgba: buffer(rgba) }
    if (request.action === 'export')
      send(
        'output',
        'Mapped plane exported as 8-bit PNG. Native samples are unchanged.',
        info,
        image,
        await png(rgba, layout.width, layout.height, signal),
        'mapped-plane.png',
      )
    else if (request.action === 'encode') {
      if (
        inspection.metadataBoxes.length ||
        h.intrinsicWidth ||
        h.intrinsicHeight ||
        h.toneMapping.intensityTarget !== 255 ||
        h.toneMapping.minNits !== 0 ||
        h.toneMapping.relativeToMaxDisplay ||
        h.toneMapping.linearBelow !== 0 ||
        h.chromaticities !== undefined
      )
        throw new Error(
          'Native writer cannot preserve this metadata combination. Download the original file; no metadata is silently dropped.',
        )
      const makePlane = (index: number): JpegXlNativePlaneInput => {
        const p = planes[index]
        if (!p) throw new Error('Missing native plane')
        const e = index < h.colorChannels ? undefined : h.extraChannels[index - h.colorChannels],
          bitDepth = e?.bitDepth.bits ?? h.bitDepth,
          exp = e?.bitDepth.exponentBits ?? h.exponentBits
        if (exp !== 0 && !(bitDepth === 32 && exp === 8) && !(bitDepth === 16 && exp === 5))
          throw new Error('Unsupported float writer layout')
        return {
          data: p,
          bitDepth,
          sampleFormat: exp === 0 ? 'unsigned-integer' : bitDepth === 32 ? 'binary32' : 'binary16',
        }
      }
      const a = makePlane(0),
        color:
          | [JpegXlNativePlaneInput]
          | [JpegXlNativePlaneInput, JpegXlNativePlaneInput, JpegXlNativePlaneInput] =
          h.colorChannels === 1 ? [a] : [a, makePlane(1), makePlane(2)]
      const extras = h.extraChannels.map((e, i): JpegXlNativeExtraInput => {
        if (![0, 1, 2, 3, 4, 5, 6, 16].includes(e.type) || e.dimShift > 3)
          throw new Error('Unsupported extra-channel writer semantics')
        const type = e.type
        if (
          type !== 0 &&
          type !== 1 &&
          type !== 2 &&
          type !== 3 &&
          type !== 4 &&
          type !== 5 &&
          type !== 6 &&
          type !== 16
        )
          throw new Error('Unsupported extra type')
        const shift = e.dimShift
        if (shift !== 0 && shift !== 1 && shift !== 2 && shift !== 3)
          throw new Error('Unsupported shift')
        return {
          ...makePlane(i + h.colorChannels),
          type,
          dimShift: shift,
          ...(e.name ? { name: e.name } : {}),
          associatedAlpha: e.associatedAlpha,
          ...(e.spotColor ? { spotColor: e.spotColor } : {}),
          ...(e.cfaChannel !== undefined ? { cfaChannel: e.cfaChannel } : {}),
        }
      })
      const orientation = h.orientation
      if (orientation !== 1)
        throw new Error('Native tool currently requires orientation 1 to preserve stored geometry')
      // The encoder validates the exact stored orientation; no canvas pixels enter this path.
      const bytes = await encodeJpegXlNative({
        width: h.width,
        height: h.height,
        color,
        extraChannels: extras,
        ...(h.iccProfile ? { iccProfile: h.iccProfile } : {}),
        colorSemantics: {
          ...srgb,
          family: h.colorChannels === 1 ? 'gray' : 'rgb',
          primaries: h.colorSemanticsPrimaries,
          transfer: h.colorSemanticsTransfer,
          renderingIntent: h.renderingIntent,
          alpha:
            h.selectedAlphaChannel === undefined
              ? 'none'
              : h.alphaAssociated
                ? 'premultiplied'
                : 'straight',
        },
        signal,
        limits,
        maxOutputBytes: 67108864,
      })

      const verify = await openJpegXlSequence(bytes, { signal, limits })
      try {
        for await (const output of verify.layers(signal)) {
          const actual = jpegXlNativeUnsignedPlanes(output)
          if (
            output.header.bitDepth !== h.bitDepth ||
            output.header.exponentBits !== h.exponentBits ||
            output.header.alphaAssociated !== h.alphaAssociated ||
            JSON.stringify(output.header.extraChannels) !== JSON.stringify(h.extraChannels) ||
            output.header.iccProfile?.length !== h.iccProfile?.length ||
            output.header.iccProfile?.some((v, i) => v !== h.iccProfile?.[i])
          )
            throw new Error('Native re-encode changed channel or profile metadata')
          if (
            actual.length !== planes.length ||
            actual.some(
              (p, i) => p.length !== planes[i]?.length || p.some((v, j) => v !== planes[i]?.[j]),
            )
          )
            throw new Error('Native re-encode changed sample bits')
          break
        }
      } finally {
        await verify.close()
      }
      send(
        'output',
        'Native re-encode verified: every stored sample bit matches.',
        { ...info, nativeBitsExact: true },
        image,
        bytes,
        'native-preserved.jxl',
      )
    } else
      send(
        'done',
        'Native samples inspected. Preview uses the explicit plane mapping.',
        info,
        image,
      )
  } finally {
    await sequence.close()
  }
}
