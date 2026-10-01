import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import {
  createImageLibrary,
  defaultImageLimits,
  type DecoderOptions,
  type ImageDecoder,
  MemorySource,
  pixelBytesPerPixel,
} from 'purejsimage/browser'
import { jpegxlCodec } from 'purejsimage/codecs/jpegxl'
import floatingFixtures from '../../../tests/fixtures/jpegxl/gap-alpha/manifest.json' with {
  type: 'json',
}
import {
  convertJpegXlFloat32LayerToRgba16,
  encodeJpegXlAnimation,
  encodeJpegXlNative,
  inspectJpegXl,
  jpegXlNativeFloat32ColorPlanes,
  jpegXlNativeUnsignedPlanes,
  openJpegXlSequence,
  openJpegXlSession,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from 'purejsimage/jpegxl'
import { hash, implementationIdentity, json, oracle, root, run, work } from './io.ts'
import { classifyError, OutputMismatch, type Status, type Subject } from './model.ts'
import { pngPixels } from './validate.ts'

const directory = `${work}/specialized`
await mkdir(directory, { recursive: true })
const rows: {
  subject: Subject
  feature: string
  status: Status
  detail: string
  evidence?: unknown
}[] = []
const files: { id: string; path: string; sha256: string; license: string }[] = []
async function save(id: string, bytes: Uint8Array) {
  const path = `${directory}/${id}.jxl`
  await writeFile(path, bytes)
  files.push({
    id,
    path,
    sha256: hash(bytes),
    license: 'MIT repository synthetic fixture; generated through public API',
  })
  return bytes
}
const values = Float32Array.from({ length: 32 }, (_, i) => (i % 8) / 2),
  bits = new Uint32Array(values.buffer)
const float = await save(
  'native-float-hdr',
  await encodeJpegXlNative({
    width: 8,
    height: 4,
    color: [
      { data: bits, bitDepth: 32, sampleFormat: 'binary32' },
      { data: bits, bitDepth: 32, sampleFormat: 'binary32' },
      { data: bits, bitDepth: 32, sampleFormat: 'binary32' },
    ],
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'linear' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
  }),
)
const gray = Uint16Array.from({ length: 32 }, (_, i) => i * 1237),
  extra = await save(
    'depth-channel',
    await encodeJpegXlNative({
      width: 8,
      height: 4,
      color: [{ data: gray, bitDepth: 16 }],
      extraChannels: [{ type: 1, name: 'depth', data: gray, bitDepth: 16 }],
    }),
  )
const icc = await readFile('tests/fixtures/jpegxl/m8-native/gray.icc'),
  iccImage = await save(
    'gray-icc',
    await encodeJpegXlNative({
      width: 8,
      height: 4,
      color: [{ data: gray, bitDepth: 16 }],
      iccProfile: icc,
    }),
  )
const parts: Uint8Array[] = []
async function* frames() {
  yield {
    width: 2,
    height: 2,
    data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    durationTicks: 3,
  }
  yield { width: 2, height: 2, data: new Uint8Array(16), durationTicks: 5 }
}
for await (const part of encodeJpegXlAnimation(frames(), {
  width: 2,
  height: 2,
  pixelFormat: 'rgba8',
  colorSemantics: {
    family: 'rgb',
    primaries: 'srgb',
    transfer: { kind: 'srgb' },
    matrix: 'identity',
    range: 'full',
    alpha: 'straight',
    provenance: 'container-signaled',
    renderingIntent: 'relative',
  },
  animation: {
    ticksPerSecondNumerator: 1000,
    ticksPerSecondDenominator: 1,
    loops: 2,
    haveTimecodes: false,
  },
}))
  parts.push(part)
const animation = await save('animation', Buffer.concat(parts))
const jpegPath = 'tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg',
  jpeg = await readFile(jpegPath)
files.push({
  id: 'original-jpeg',
  path: jpegPath,
  sha256: hash(jpeg),
  license: 'Repository generated fixture, MIT',
})
const progressivePath =
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
  progressive = await readFile(progressivePath)
files.push({
  id: 'progressive',
  path: progressivePath,
  sha256: hash(progressive),
  license: 'Repository generated fixture, MIT',
})
run(`${oracle}/djxl`, [
  progressivePath,
  `${directory}/progressive-reference.png`,
  '--num_threads=1',
  '--bits_per_sample=8',
])
const progressiveReference = await pngPixels(`${directory}/progressive-reference.png`)
async function probe(subject: Subject, feature: string, action: () => Promise<unknown>) {
  try {
    rows.push({
      subject,
      feature,
      status: 'verified',
      detail: 'All declared assertions passed',
      evidence: await action(),
    })
  } catch (error) {
    rows.push({ subject, feature, ...classifyError(error) })
  }
}
async function requireEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new OutputMismatch(
      `Semantic mismatch: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
    )
}
const images = createImageLibrary({ codecs: [jpegxlCodec] })
async function ordinaryDecoder(
  input: Uint8Array,
  options: DecoderOptions = {},
): Promise<ImageDecoder> {
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(input),
    defaultImageLimits,
    options,
  )
  if (!decoder) throw new Error('Ordinary JPEG XL decoder unavailable')
  return decoder
}
async function ordinaryRows(decoder: ImageDecoder): Promise<Uint8Array> {
  const stride = decoder.width * pixelBytesPerPixel(decoder.pixelFormat)
  const output = new Uint8Array(stride * decoder.height)
  let rows = 0
  for await (const block of decoder.decode({})) {
    try {
      if (
        block.x !== 0 ||
        block.y !== rows ||
        block.width !== decoder.width ||
        block.format !== decoder.pixelFormat
      )
        throw new OutputMismatch('Ordinary output layout changed')
      for (let y = 0; y < block.height; y++)
        output.set(
          block.data.subarray(y * block.stride, y * block.stride + stride),
          (rows + y) * stride,
        )
      rows += block.height
    } finally {
      block.release?.()
    }
  }
  if (rows !== decoder.height) throw new OutputMismatch('Ordinary output rows missing')
  return output
}
await probe('purejsimage', 'ordinary wide integer preservation', async () => {
  const samples = Uint32Array.of(0, 1, 123456789, 2147483647)
  const input = await save(
    'ordinary-rgb31',
    await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [
        { data: samples, bitDepth: 31 },
        { data: samples, bitDepth: 31 },
        { data: samples, bitDepth: 31 },
      ],
    }),
  )
  const encoded = await save(
    'ordinary-rgb31-reencoded',
    await (await images.open(input)).jpegxl().toUint8Array(),
  )
  const decoder = await ordinaryDecoder(encoded)
  if (decoder.pixelFormat !== 'rgb32' || decoder.execution?.sourceSampleBitDepths[0] !== 31)
    throw new OutputMismatch('Wide integer precision changed')
  const bytes = await ordinaryRows(decoder),
    view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++)
    for (let c = 0; c < 3; c++)
      if (view.getUint32((i * 3 + c) * 4, false) !== samples[i])
        throw new OutputMismatch('Wide integer sample changed')
  return { bitDepth: 31, pixelFormat: decoder.pixelFormat, outputSha256: hash(bytes), exact: true }
})
await probe('purejsimage', 'ordinary integer color with floating alpha', async () => {
  const color = Uint8Array.of(0, 17, 128, 255),
    alpha = Float32Array.of(0, 0.25, 0.5, 1)
  const input = await save(
    'ordinary-mixed-alpha',
    await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [
        { data: color, bitDepth: 8 },
        { data: color, bitDepth: 8 },
        { data: color, bitDepth: 8 },
      ],
      extraChannels: [
        { type: 0, bitDepth: 32, sampleFormat: 'binary32', data: new Uint32Array(alpha.buffer) },
      ],
    }),
  )
  const decoder = await ordinaryDecoder(input)
  if (decoder.pixelFormat !== 'rgbaf32') throw new OutputMismatch('Mixed alpha format changed')
  const bytes = await ordinaryRows(decoder),
    view = new DataView(bytes.buffer)
  for (let i = 0; i < color.length; i++) {
    for (let c = 0; c < 3; c++)
      if (view.getFloat32((i * 4 + c) * 4, false) !== Math.fround((color[i] ?? 0) / 255))
        throw new OutputMismatch('Mixed color changed')
    if (view.getFloat32((i * 4 + 3) * 4, false) !== alpha[i])
      throw new OutputMismatch('Floating alpha changed')
  }
  return { pixelFormat: decoder.pixelFormat, outputSha256: hash(bytes), alphaExact: true }
})
await probe('purejsimage', 'ordinary Float32 lossless encoding', async () => {
  const encoded = await save(
    'ordinary-float-preserved',
    await (await images.open(float)).jpegxl().toUint8Array(),
  )
  const decoder = await ordinaryDecoder(encoded)
  if (decoder.pixelFormat !== 'rgbf32') throw new OutputMismatch('Float storage changed')
  const bytes = await ordinaryRows(decoder),
    view = new DataView(bytes.buffer)
  for (let i = 0; i < values.length; i++)
    for (let c = 0; c < 3; c++)
      if (view.getUint32((i * 3 + c) * 4, false) !== bits[i])
        throw new OutputMismatch('Float sample bits changed')
  return { pixelFormat: decoder.pixelFormat, outputSha256: hash(bytes), exactSampleBits: true }
})
await probe('purejsimage', 'ordinary integer ICC preservation', async () => {
  const encoded = await save(
    'ordinary-gray-icc',
    await (await images.open(iccImage, { colorOutput: 'preserve' }))
      .keepIcc()
      .jpegxl()
      .toUint8Array(),
  )
  const inspection = await inspectJpegXl(encoded)
  await requireEqual(inspection.icc, { present: true, decodedBytes: icc.length })
  const sequence = await openJpegXlSequence(encoded)
  try {
    for await (const header of sequence.headers()) {
      await requireEqual(hash(header.iccProfile ?? new Uint8Array()), hash(icc))
      break
    }
  } finally {
    await sequence.close()
  }
  const decoder = await ordinaryDecoder(encoded, { colorOutput: 'preserve' }),
    bytes = await ordinaryRows(decoder),
    view = new DataView(bytes.buffer)
  if (decoder.pixelFormat !== 'gray16') throw new OutputMismatch('Source-profile samples converted')
  for (let i = 0; i < gray.length; i++)
    if (view.getUint16(i * 2, false) !== gray[i]) throw new OutputMismatch('ICC sample changed')
  return { profileSha256: hash(icc), outputSha256: hash(bytes), samplesExact: true }
})
await probe('purejsimage', 'floating VarDCT and linear HDR reference blends', async () => {
  const cases = []
  for (const fixture of floatingFixtures.fixtures) {
    const path = `tests/fixtures/jpegxl/gap-alpha/${fixture.file}`,
      input = new Uint8Array(await readFile(path)),
      reference = new Uint8Array(
        gunzipSync(await readFile(`tests/fixtures/jpegxl/gap-alpha/${fixture.id}.bin.gz`)),
      )
    await requireEqual(hash(input), fixture.sha256)
    await requireEqual(hash(reference), fixture.referenceSha256)
    const decoder = await ordinaryDecoder(input)
    if (decoder.pixelFormat !== 'rgbaf32')
      throw new OutputMismatch('Floating VarDCT storage changed')
    const bytes = await ordinaryRows(decoder)
    if (bytes.length !== reference.length) throw new OutputMismatch('Floating output size changed')
    const own = new DataView(bytes.buffer),
      expected = new DataView(reference.buffer)
    let maximumColor = 0,
      maximumAlpha = 0
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const difference = Math.abs(
        own.getFloat32(offset, false) - expected.getFloat32(offset, false),
      )
      if (!Number.isFinite(difference)) throw new OutputMismatch('Nonfinite output')
      if (offset % 16 === 12) maximumAlpha = Math.max(maximumAlpha, difference)
      else maximumColor = Math.max(maximumColor, difference)
    }
    if (maximumColor > 1 / 255 || maximumAlpha > (fixture.blend ? 1.2e-7 : 0))
      throw new OutputMismatch('Independent floating output differs')
    files.push({ id: fixture.id, path, sha256: hash(input), license: floatingFixtures.license })
    cases.push({
      id: fixture.id,
      maximumColor,
      maximumAlpha,
      inputSha256: hash(input),
      referenceSha256: hash(reference),
      outputSha256: hash(bytes),
    })
  }
  return { oracle: floatingFixtures.oracle, librarySha256: floatingFixtures.librarySha256, cases }
})
await probe('purejsimage', 'native float and HDR headroom', async () => {
  const seq = await openJpegXlSequence(float)
  try {
    let count = 0
    for await (const layer of seq.layers()) {
      for (const plane of jpegXlNativeFloat32ColorPlanes(layer))
        await requireEqual(Array.from(new Uint32Array(plane.buffer)), Array.from(bits))
      const views = []
      for (const white of [1, 2, 4]) {
        const display = convertJpegXlFloat32LayerToRgba16(layer, { black: 0, white })
        for (let i = 0; i < values.length; i++)
          for (let c = 0; c < 3; c++)
            if (
              Math.abs(
                (display.data[i * 4 + c] ?? 0) -
                  Math.round(Math.min(1, (values[i] ?? 0) / white) * 65535),
              ) > 1
            )
              throw new OutputMismatch('Explicit display range mismatch')
        views.push({
          white,
          width: display.width,
          height: display.height,
          hash: hash(new Uint8Array(display.data.buffer)),
        })
      }
      count++
      return { count, views, source: files[0], nativeBitsExact: true }
    }
    throw new Error('Missing layer')
  } finally {
    await seq.close()
  }
})
await probe('purejsimage', 'extra channel samples and meaning', async () => {
  const seq = await openJpegXlSequence(extra)
  try {
    for await (const layer of seq.layers()) {
      const planes = jpegXlNativeUnsignedPlanes(layer)
      await requireEqual(Array.from(planes[1] ?? []), Array.from(gray))
      await requireEqual(layer.header.extraChannels[0]?.type, 1)
      return {
        type: layer.header.extraChannels[0]?.type,
        name: layer.header.extraChannels[0]?.name,
        samples: planes[1]?.length,
      }
    }
    throw new Error('No layer')
  } finally {
    await seq.close()
  }
})
await probe('purejsimage', 'ICC preservation', async () => {
  const seq = await openJpegXlSequence(iccImage)
  try {
    for await (const header of seq.headers()) {
      await requireEqual(hash(header.iccProfile ?? new Uint8Array()), hash(icc))
      return { sha256: hash(icc), inspection: await inspectJpegXl(iccImage) }
    }
    throw new Error('No header')
  } finally {
    await seq.close()
  }
})
await probe(
  'purejsimage',
  'animation encode, decode, composition, timing and frame access',
  async () => {
    const seq = await openJpegXlSequence(animation)
    try {
      const result = []
      for await (const frame of seq.frames())
        result.push({
          index: frame.index,
          width: frame.width,
          height: frame.height,
          duration: frame.durationTicks,
          start: frame.startTicks,
          alpha: Array.from(frame.planes[3] ?? []),
        })
      await requireEqual(
        result.map((f) => f.duration),
        [3, 5],
      )
      await requireEqual(
        result.map((f) => f.start),
        ['0', '3'],
      )
      await requireEqual(result[1]?.alpha, [0, 0, 0, 0])
      const second = await seq.frame(1)
      await requireEqual(second.durationTicks, 5)
      return {
        frames: result,
        loops: second.header.animation?.loops,
        statusScope:
          'Experimental animation; two full replacement frames only, blend-mode corpus not retested',
      }
    } finally {
      await seq.close()
    }
  },
)
await probe('purejsimage', 'exact JPEG recompression and reconstruction', async () => {
  const encoded = await transcodeJpegToJpegXl(jpeg)
  const reconstructed = await reconstructJpegFromJpegXl(encoded.data)
  await requireEqual(hash(reconstructed), hash(jpeg))
  await save('jpeg-recompressed', encoded.data)
  return {
    jpegSha256: hash(jpeg),
    reconstructedSha256: hash(reconstructed),
    bytes: encoded.data.length,
  }
})
await probe('purejsimage', 'region, reduced resolution, preview and selective reads', async () => {
  const reads: { offset: number; length: number }[] = [],
    start = performance.now(),
    source = {
      size: progressive.length,
      async read(offset: number, length: number) {
        const data = progressive.subarray(offset, Math.min(progressive.length, offset + length))
        reads.push({ offset, length: data.length })
        return data
      },
    }
  const session = await openJpegXlSession(source)
  try {
    const stages = []
    let firstUsefulMs: number | null = null,
      requestedAtFirst: number | null = null,
      blocks = 0,
      maximumFinalError = 0,
      squaredFinalError = 0,
      finalSamples = 0
    for await (const event of session.progressive({
      region: { x: 10, y: 10, width: 32, height: 32 },
      scaleDenominator: 2,
    })) {
      if (event.type === 'block') {
        if (firstUsefulMs === null) {
          firstUsefulMs = performance.now() - start
          requestedAtFirst = reads.reduce((sum, r) => sum + r.length, 0)
        }
        if (event.block.width < 1 || event.block.height < 1) throw new Error('Empty preview')
        blocks++
        if (event.stage.kind === 'final') {
          const block = event.block
          if (block.format !== 'rgb8') throw new OutputMismatch('Expected RGB8 final preview')
          for (let y = 0; y < block.height; y++)
            for (let x = 0; x < block.width; x++)
              for (let c = 0; c < 3; c++) {
                const index =
                  ((10 + (block.y + y) * 2 + 1) * progressiveReference.width +
                    10 +
                    (block.x + x) * 2 +
                    1) *
                    4 +
                  c
                const difference = Math.abs(
                  (block.data[y * block.stride + x * 3 + c] ?? 0) -
                    (progressiveReference.data[index] ?? 0),
                )
                maximumFinalError = Math.max(maximumFinalError, difference)
                squaredFinalError += difference * difference
                finalSamples++
              }
        }
        event.block.release?.()
      } else if (event.type === 'stage-complete')
        stages.push({
          kind: event.stage.kind,
          width: event.stage.width,
          height: event.stage.height,
          groups: event.stage.plan.groupIds,
        })
    }
    if (!blocks) throw new Error('No progressive pixels')
    if (
      finalSamples !== 16 * 16 * 3 ||
      maximumFinalError > 2 ||
      Math.sqrt(squaredFinalError / finalSamples) > 0.55
    )
      throw new OutputMismatch(
        `Final reduced region differs from native reference: samples=${finalSamples}, max=${maximumFinalError}, RMSE=${Math.sqrt(squaredFinalError / finalSamples)}`,
      )
    return {
      firstUsefulMs,
      requestedAtFirst,
      requestedTotal: reads.reduce((sum, r) => sum + r.length, 0),
      inputBytes: progressive.length,
      reads,
      stages,
      transport:
        'in-memory read callback; requested counts include repeated reads; no network transfer claimed',
      qualityValidation:
        'Final reduced region compared to native libjxl full decode, center-sampled at scale 2; max RGB8 2 and RMSE .55. First DC preview fidelity not independently scored.',
      maximumFinalError,
      finalRmse: Math.sqrt(squaredFinalError / finalSamples),
      finalSamples,
    }
  } finally {
    await session.close()
  }
})
const oxide = await import('jxl-oxide-wasm')
await oxide.default({ module_or_path: new Uint8Array(await readFile(`${work}/assets/oxide.wasm`)) })
await probe('oxide', 'animation decode, frame timing and frame access', async () => {
  const image = new oxide.JxlImage()
  try {
    image.feedBytes(animation)
    if (!image.tryInit()) throw new Error('No header')
    await requireEqual(image.animated, true)
    await requireEqual(image.numLoadedKeyframes, 2)
    const frames = []
    for (let i = 0; i < 2; i++) {
      const frame = image.render(i)
      const duration = frame.durationNumerator / frame.durationDenominator,
        bytes = frame.encodeToPng()
      await writeFile(`${directory}/oxide-frame-${i}.png`, bytes)
      const p = await pngPixels(`${directory}/oxide-frame-${i}.png`)
      await requireEqual([p.width, p.height], [2, 2])
      if (i === 1)
        for (let a = 3; a < p.data.length; a += 4)
          if (p.data[a] !== 0) throw new OutputMismatch('Wrong composed alpha')
      frames.push({ duration, sha256: hash(bytes) })
    }
    await requireEqual(
      frames.map((f) => f.duration),
      [0.003, 0.005],
    )
    return { frames, loops: image.numLoops }
  } finally {
    image.free()
  }
})
await probe('oxide', 'animation frame access and composition', async () => {
  const image = new oxide.JxlImage()
  try {
    image.feedBytes(animation)
    if (!image.tryInit()) throw new Error('No animation header')
    await requireEqual(image.numLoadedKeyframes, 2)
    await requireEqual(image.numLoops, 2)
    const frame = image.render(1),
      bytes = frame.encodeToPng()
    await writeFile(`${directory}/oxide-second-frame.png`, bytes)
    const pixels = await pngPixels(`${directory}/oxide-second-frame.png`)
    await requireEqual([pixels.width, pixels.height], [2, 2])
    for (let i = 3; i < pixels.data.length; i += 4)
      if (pixels.data[i] !== 0) throw new OutputMismatch('Wrong second-frame alpha')
    return {
      frameIndex: 1,
      width: pixels.width,
      height: pixels.height,
      loops: image.numLoops,
      sha256: hash(bytes),
      scope: 'Full replacement frame; timing qualified separately',
    }
  } finally {
    image.free()
  }
})
await probe('oxide', 'incremental input and first useful preview', async () => {
  const image = new oxide.JxlImage(),
    start = performance.now()
  let delivered = 0,
    initialized = false
  const attempts: unknown[] = []
  try {
    while (delivered < progressive.length) {
      const next = progressive.subarray(delivered, Math.min(progressive.length, delivered + 4096))
      const consumed = image.feedBytes(next)
      delivered += consumed
      if (!consumed) break
      initialized ||= image.tryInit()
      if (initialized) {
        try {
          const frame = image.render(),
            bytes = frame.encodeToPng()
          await writeFile(`${directory}/oxide-preview.png`, bytes)
          const p = await pngPixels(`${directory}/oxide-preview.png`)
          return {
            firstUsefulMs: performance.now() - start,
            delivered,
            inputBytes: progressive.length,
            beforeComplete: delivered < progressive.length,
            width: p.width,
            height: p.height,
            sha256: hash(bytes),
            attempts,
            transport: 'in-memory chunks; no network read callback',
          }
        } catch (error) {
          attempts.push({ delivered, error: String(error) })
        }
      }
    }
    throw new Error(`No preview: ${JSON.stringify(attempts)}`)
  } finally {
    image.free()
  }
})
await probe('oxide', 'region reconstruction', async () => {
  const image = new oxide.JxlImage()
  try {
    image.feedBytes(progressive)
    if (!image.tryInit()) throw new Error('No header')
    image.renderingRegion = { left: 10, top: 10, width: 32, height: 32 }
    const frame = image.render(0),
      bytes = frame.encodeToPng()
    await writeFile(`${directory}/oxide-region.png`, bytes)
    const p = await pngPixels(`${directory}/oxide-region.png`)
    await requireEqual([p.width, p.height], [32, 32])
    let maximumError = 0
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        for (let c = 0; c < 4; c++)
          maximumError = Math.max(
            maximumError,
            Math.abs(
              (p.data[(y * 32 + x) * 4 + c] ?? 0) -
                (progressiveReference.data[
                  ((y + 10) * progressiveReference.width + x + 10) * 4 + c
                ] ?? 0),
            ),
          )
    if (maximumError > 2) throw new OutputMismatch(`Region pixel mismatch: ${maximumError}`)
    return {
      width: p.width,
      height: p.height,
      sha256: hash(bytes),
      inputBytes: progressive.length,
      selectiveSourceReads: false,
      qualityValidation:
        'Every RGBA8 crop sample compared to independent native reference, maximum tolerance 2',
      maximumError,
    }
  } finally {
    image.free()
  }
})
await probe('oxide', 'ICC access', async () => {
  const image = new oxide.JxlImage()
  try {
    image.feedBytes(iccImage)
    if (!image.tryInit()) throw new Error('No header')
    const frame = image.render(0)
    try {
      await requireEqual(hash(frame.iccProfile), hash(icc))
      return { sha256: hash(frame.iccProfile) }
    } finally {
      frame.free()
    }
  } finally {
    image.free()
  }
})
const { default: Vips } = await import('wasm-vips'),
  vips = await Vips({ dynamicLibraries: ['vips-jxl.wasm'] })
const vipsConfiguration = {
  configuration: vips.config(),
  version: vips.version(),
  emscripten: vips.emscriptenVersion(),
}
vips.concurrency(1)
vips.Cache.max(0)
await probe('vips', 'native float HDR', async () => {
  const image = vips.Image.jxlloadBuffer(float)
  try {
    const data = image.writeToMemory()
    if (!(data instanceof Float32Array))
      throw new Error(`Expected float32, got ${data.constructor.name}`)
    for (let i = 0; i < values.length; i++)
      for (let c = 0; c < 3; c++)
        if (data[i * 3 + c] !== values[i]) throw new OutputMismatch('Native float changed')
    return {
      width: image.width,
      height: image.height,
      interpretation: image.interpretation,
      maximum: Math.max(...data),
      sha256: hash(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
    }
  } finally {
    image.delete()
  }
})
await probe('vips', 'animation decode, frame timing and composition', async () => {
  const image = vips.Image.jxlloadBuffer(animation, { n: -1 })
  try {
    const height = image.getInt('page-height'),
      delay = image.getArrayInt('delay'),
      data = image.writeToMemory()
    await requireEqual([image.width, height, image.height / height], [2, 2, 2])
    await requireEqual(delay, [3, 5])
    for (let i = 16 + 3; i < data.length; i += 4)
      if (data[i] !== 0) throw new OutputMismatch('Second-frame alpha mismatch')
    return { frames: image.height / height, delay, pageHeight: height, loop: image.getInt('loop') }
  } finally {
    image.delete()
  }
})
await probe('vips', 'animation frame access', async () => {
  const image = vips.Image.jxlloadBuffer(animation, { page: 1, n: 1 })
  try {
    const data = image.writeToMemory()
    await requireEqual([image.width, image.height], [2, 2])
    for (let i = 3; i < data.length; i += 4)
      if (data[i] !== 0) throw new OutputMismatch('Wrong frame')
    return { page: 1, samples: data.length }
  } finally {
    image.delete()
  }
})
await probe('vips', 'ICC access', async () => {
  const image = vips.Image.jxlloadBuffer(iccImage)
  try {
    const profile = image.getBlob('icc-profile-data')
    await requireEqual(hash(profile), hash(icc))
    return { sha256: hash(profile) }
  } finally {
    image.delete()
  }
})
await probe('vips', 'animation encode with exact 3/5 ms delays', async () => {
  const image = vips.Image.jxlloadBuffer(animation, { n: -1 })
  try {
    const bytes = image.jxlsaveBuffer({ lossless: true, page_height: 2, effort: 1 })
    await save('vips-animation', bytes)
    const decoded = vips.Image.jxlloadBuffer(bytes, { n: -1 })
    try {
      decoded.writeToMemory()
      await requireEqual(decoded.getArrayInt('delay'), [3, 5])
      await requireEqual(decoded.getInt('page-height'), 2)
      return { sha256: hash(bytes), frames: decoded.height / 2 }
    } finally {
      decoded.delete()
    }
  } finally {
    image.delete()
  }
})
await probe('vips', 'animation encode at ordinary 30/50 ms delays', async () => {
  const image = vips.Image.jxlloadBuffer(animation, { n: -1 })
  try {
    image.setArrayInt('delay', [30, 50])
    const bytes = image.jxlsaveBuffer({ lossless: true, page_height: 2, effort: 1 })
    await save('vips-animation-ordinary-delays', bytes)
    const decoded = vips.Image.jxlloadBuffer(bytes, { n: -1 })
    try {
      decoded.writeToMemory()
      await requireEqual(decoded.getArrayInt('delay'), [30, 50])
      await requireEqual(decoded.getInt('page-height'), 2)
      return { sha256: hash(bytes), delays: [30, 50], frames: decoded.height / 2 }
    } finally {
      decoded.delete()
    }
  } finally {
    image.delete()
  }
})
vips.shutdown()
// Independent stream validity on every generated specialized stream, without treating validity as sample correctness.
const independent = []
for (const file of files.filter((f) => f.path.startsWith(directory) && f.path.endsWith('.jxl'))) {
  try {
    const text = run(`${oracle}/djxl`, [file.path, `${file.path}.png`, '--num_threads=1'])
    independent.push({
      id: file.id,
      status: 'decoded',
      decoderSha256: hash(await readFile(`${oracle}/djxl`)),
      output: text,
    })
  } catch (error) {
    independent.push({ id: file.id, status: 'execution failure', detail: String(error) })
  }
}
await json(`${root}/results/specialized-node.json`, {
  schemaVersion: 1,
  ...(await implementationIdentity()),
  date: new Date().toISOString(),
  runtime: process.version,
  vipsConfiguration,
  oxideVersion: oxide.version(),
  files,
  rows,
  independent,
  scope:
    'Node specialized public APIs; browser specialized behavior not inferred. Existing official conformance remains separate.',
})
console.log(
  rows
    .map(
      (r) => `${r.subject}: ${r.feature}: ${r.status} ${r.status === 'verified' ? '' : r.detail}`,
    )
    .join('\n'),
)
