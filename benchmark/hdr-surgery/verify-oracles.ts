import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { createPureJsImageSrgbIcc } from '../../src/hdr/srgb-icc.ts'
import {
  assembleGainMapJpeg,
  normalizeGainMapMetadata,
  openGainMapImage,
} from '../../src/hdr/index.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

const run = (command: string, args: readonly string[]): CommandResult => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${String(result.status)}\n${result.stdout}${result.stderr}`,
    )
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

const scalar = (text: string, label: string): number => {
  const match = new RegExp(`--${label}\\s+([-+0-9.eE]+)`, 'u').exec(text)
  if (!match?.[1]) throw new Error(`libultrahdr did not report --${label}`)
  const value = Number(match[1])
  if (!Number.isFinite(value)) throw new Error(`libultrahdr reported an invalid --${label}`)
  return value
}

const requireClose = (actual: number, expected: number, label: string, tolerance = 1e-5): void => {
  if (Math.abs(actual - expected) > tolerance * Math.max(1, Math.abs(expected))) {
    throw new Error(`${label} disagrees: oracle=${actual}, PureJsImage=${expected}`)
  }
}

const encodeJpeg = async (
  width: number,
  height: number,
  pixelFormat: 'gray8' | 'rgb8',
  data: Uint8Array,
): Promise<Uint8Array> => {
  if (!jpegCodec.createEncoder) throw new Error('JPEG encoder is unavailable')
  const sink = new Uint8ArraySink()
  const encoder = await jpegCodec.createEncoder(sink, {
    width,
    height,
    pixelFormat,
    options: { quality: 100, chromaSubsampling: '444' },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * (pixelFormat === 'gray8' ? 1 : 3),
    format: pixelFormat,
    data,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const color = Object.freeze({
  family: 'rgb' as const,
  primaries: 'srgb' as const,
  transfer: Object.freeze({ kind: 'srgb' as const }),
  matrix: 'identity' as const,
  range: 'full' as const,
  alpha: 'none' as const,
  provenance: 'container-signaled' as const,
})

const createAnalyticJpeg = async (): Promise<Uint8Array> => {
  const width = 48
  const height = 24
  const gainWidth = 12
  const gainHeight = 6
  const basePixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(((x + y) * 255) / (width + height - 2))
      basePixels.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3)
    }
  }
  const gainPixels = new Uint8Array(gainWidth * gainHeight)
  gainPixels.fill(255)
  const metadata = normalizeGainMapMetadata({
    baseRendition: 'sdr',
    channelCount: 1,
    baseDimensions: { width, height },
    gainMapDimensions: { width: gainWidth, height: gainHeight },
    minimum: 0,
    maximum: 2,
    gamma: 1,
    offsetSdr: 0,
    offsetHdr: 0,
    capacityMinimum: 0,
    capacityMaximum: 2,
    useBaseColorSpace: true,
    baseColor: color,
    alternateColor: { ...color, transfer: { kind: 'linear' } },
    gainMapColor: {
      ...color,
      family: 'gray',
      transfer: { kind: 'linear' },
    },
    container: 'jpeg',
    representations: ['iso-21496-1', 'ultra-hdr-xmp'],
    selectedRepresentation: 'iso-21496-1',
    metadataRanges: [],
    orientation: 1,
    warnings: [],
  })
  return assembleGainMapJpeg({
    baseJpeg: await encodeJpeg(width, height, 'rgb8', basePixels),
    gainMapJpeg: await encodeJpeg(gainWidth, gainHeight, 'gray8', gainPixels),
    metadata,
  })
}

const halfToNumber = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const fixture = 'benchmark/corpus/files/hdr-surgery-synthetic-dual.jpg'
const libultrahdr = process.env.PUREJSIMAGE_LIBULTRAHDR_APP
if (!libultrahdr) {
  throw new Error(
    'Set PUREJSIMAGE_LIBULTRAHDR_APP to the pinned libultrahdr v2.0.0 ultrahdr_app binary',
  )
}
const avifgainmaputil = process.env.PUREJSIMAGE_AVIF_GAIN_MAP_UTIL ?? 'avifgainmaputil'
const iccDumpProfile = process.env.PUREJSIMAGE_ICC_DUMP_PROFILE
const transicc = process.env.PUREJSIMAGE_TRANSICC
const libavifInclude = process.env.PUREJSIMAGE_LIBAVIF_INCLUDE
const libavifLibrary = process.env.PUREJSIMAGE_LIBAVIF_LIBRARY
if (!iccDumpProfile) {
  throw new Error(
    'Set PUREJSIMAGE_ICC_DUMP_PROFILE to iccDEV v2.3.2.3 commit 9f1707e iccDumpProfile',
  )
}
if (!transicc) throw new Error('Set PUREJSIMAGE_TRANSICC to Little CMS 2.16 transicc')
if (!libavifInclude || !libavifLibrary) {
  throw new Error(
    'Set PUREJSIMAGE_LIBAVIF_INCLUDE and PUREJSIMAGE_LIBAVIF_LIBRARY for libavif v1.3.0',
  )
}
const temporary = await mkdtemp(join(tmpdir(), 'purejsimage-hdr-oracle-'))

const validateIcc = (path: string, label: string): void => {
  const validation = run(iccDumpProfile, ['-v', '100', path, 'ALL']).stdout
  if (
    !validation.includes('IccProfLib version 2.3.2.3+9f1707e') ||
    !validation.includes('Profile is valid for version 4.30')
  ) {
    throw new Error(`iccDEV rejected the ${label} ICC profile\n${validation}`)
  }
}

const validateLittleCms = async (path: string, label: string): Promise<void> => {
  const input = join(temporary, `${label}-rgb.txt`)
  const xyz = join(temporary, `${label}-xyz.txt`)
  const roundTrip = join(temporary, `${label}-roundtrip.txt`)
  await writeFile(
    input,
    'CGATS.17\nNUMBER_OF_FIELDS 4\nBEGIN_DATA_FORMAT\nSAMPLE_ID RGB_R RGB_G RGB_B\nEND_DATA_FORMAT\nNUMBER_OF_SETS 5\nBEGIN_DATA\nblack 0 0 0\nred 255 0 0\ngreen 0 255 0\nblue 0 0 255\nmixed 64 128 192\nEND_DATA\n',
  )
  const forward = run(transicc, ['-v1', '-n', `-i${path}`, '-o*XYZ', input, xyz])
  if (!`${forward.stdout}${forward.stderr}`.includes('LittleCMS 2.16')) {
    throw new Error('Little CMS oracle version is not 2.16')
  }
  run(transicc, ['-v1', '-n', '-i*XYZ', `-o${path}`, xyz, roundTrip])
  const text = await readFile(roundTrip, 'utf8')
  const mixed = /^\s*mixed\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/mu.exec(text)
  if (!mixed) throw new Error(`Little CMS did not emit the ${label} round-trip sample`)
  for (const [index, expected] of [64, 128, 192].entries()) {
    requireClose(Number(mixed[index + 1]), expected, `${label} round-trip channel ${index}`, 0.001)
  }
}

try {
  const standaloneIccPath = join(temporary, 'purejsimage-srgb-v43.icc')
  await writeFile(standaloneIccPath, createPureJsImageSrgbIcc())
  validateIcc(standaloneIccPath, 'standalone')
  await validateLittleCms(standaloneIccPath, 'standalone')

  const opened = await openGainMapImage(new Uint8Array(await readFile(fixture)))
  const metadata = opened.inspection().metadata
  const jpeg = await opened.jpeg({ metadataMode: 'dual', baseQuality: 95, gainMapQuality: 95 })
  const jpegPath = join(temporary, 'purejsimage-dual.jpg')
  await writeFile(jpegPath, jpeg)
  const reopenedJpeg = await openGainMapImage(jpeg)
  const primaryJpeg = await reopenedJpeg.extractOriginalBase()
  reopenedJpeg.close()
  const embeddedMetadata = await jpegCodec.preservedMetadata?.(
    new MemorySource(primaryJpeg),
    defaultImageLimits,
    { exif: false, icc: true },
  )
  const embeddedIcc = embeddedMetadata?.icc
  if (!embeddedIcc) throw new Error('Generated HDR JPEG primary has no embedded ICC profile')
  if (!embeddedIcc.every((value, index) => createPureJsImageSrgbIcc()[index] === value)) {
    throw new Error('Generated HDR JPEG primary ICC differs from the pinned profile')
  }
  const embeddedIccPath = join(temporary, 'purejsimage-embedded-srgb-v43.icc')
  await writeFile(embeddedIccPath, embeddedIcc)
  validateIcc(embeddedIccPath, 'embedded JPEG primary')
  await validateLittleCms(embeddedIccPath, 'embedded')

  const probe = run(libultrahdr, ['-m', '1', '-j', jpegPath, '-P']).stdout
  if (!probe.includes('Ultra HDR Image: Yes')) {
    throw new Error(`libultrahdr rejected the generated dual-metadata JPEG\n${probe}`)
  }
  requireClose(scalar(probe, 'minContentBoost'), 2 ** (metadata.minimum[0] ?? 0), 'minimum boost')
  requireClose(scalar(probe, 'maxContentBoost'), 2 ** (metadata.maximum[0] ?? 0), 'maximum boost')
  requireClose(scalar(probe, 'gamma'), metadata.gamma[0] ?? 1, 'gamma')
  requireClose(scalar(probe, 'offsetSdr'), metadata.offsetSdr[0] ?? 0, 'SDR offset')
  requireClose(scalar(probe, 'offsetHdr'), metadata.offsetHdr[0] ?? 0, 'HDR offset')
  requireClose(scalar(probe, 'hdrCapacityMin'), 2 ** metadata.capacityMinimum, 'minimum capacity')
  requireClose(scalar(probe, 'hdrCapacityMax'), 2 ** metadata.capacityMaximum, 'maximum capacity')

  const analyticPath = join(temporary, 'purejsimage-analytic.jpg')
  await writeFile(analyticPath, await createAnalyticJpeg())
  const analytic = await openGainMapImage(new Uint8Array(await readFile(analyticPath)))
  const analyticMetadata = analytic.inspection().metadata
  const rawPath = join(temporary, 'libultrahdr-linear-rgba16f.raw')
  run(libultrahdr, ['-m', '1', '-j', analyticPath, '-o', '0', '-O', '4', '-z', rawPath])
  const oracle = new Uint8Array(await readFile(rawPath))
  const width = analyticMetadata.baseDimensions.width
  const height = analyticMetadata.baseDimensions.height
  if (oracle.byteLength !== width * height * 8) {
    throw new Error(
      `libultrahdr RGBA16F output has ${oracle.byteLength} bytes, expected ${width * height * 8}`,
    )
  }
  const oracleView = new DataView(oracle.buffer, oracle.byteOffset, oracle.byteLength)
  let compared = 0
  let squareError = 0
  let maximumError = 0
  let maximumErrorAt = ''
  const samples: string[] = []
  let rowOffset = 0
  for await (const block of analytic.render({
    displayBoost: 2 ** analyticMetadata.capacityMaximum,
  })) {
    for (let row = 0; row < block.height; row += 1) {
      for (let x = 0; x < block.width; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = block.data[row * block.stride + x * 3 + channel] ?? 0
          const actual = halfToNumber(
            oracleView.getUint16(((rowOffset + row) * width + x) * 8 + channel * 2, true),
          )
          const error = Math.abs(actual - expected)
          if (error > maximumError) {
            maximumError = error
            maximumErrorAt = `${x},${rowOffset + row},${channel}: oracle=${actual}, PureJsImage=${expected}`
          }
          if (samples.length < 12 && x % 80 === 0 && (rowOffset + row) % 45 === 0) {
            samples.push(
              `${x},${rowOffset + row},${channel}:${actual.toFixed(5)}/${expected.toFixed(5)}`,
            )
          }
          squareError += error * error
          compared += 1
        }
        const alpha = halfToNumber(
          oracleView.getUint16(((rowOffset + row) * width + x) * 8 + 6, true),
        )
        requireClose(alpha, 1, 'oracle alpha', 0)
      }
    }
    rowOffset += block.height
  }
  const rmse = Math.sqrt(squareError / compared)
  if (maximumError > 0.08 || rmse > 0.012) {
    throw new Error(
      `linear HDR pixels exceed tolerance: max=${maximumError}, rmse=${rmse}, at=${maximumErrorAt}, samples=${samples.join(';')}`,
    )
  }
  analytic.close()

  const avif = await opened.resize({ width: 64, height: 36, kernel: 'bilinear' }).avif()
  const avifPath = join(temporary, 'purejsimage-gain-map.avif')
  const toneMappedPath = join(temporary, 'tone-mapped.png')
  await writeFile(avifPath, avif)
  const avifMetadata = run(avifgainmaputil, ['printmetadata', avifPath]).stdout
  for (const label of ['Base headroom', 'Gain Map Min', 'Gain Map Max', 'Gain Map Gamma']) {
    if (!avifMetadata.toLowerCase().includes(label.toLowerCase())) {
      throw new Error(`avifgainmaputil output is missing ${label}\n${avifMetadata}`)
    }
  }
  run(avifgainmaputil, ['tonemap', avifPath, toneMappedPath, '--headroom', '3'])
  const png = new Uint8Array(await readFile(toneMappedPath))
  if (
    png.byteLength < 8 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => png[index] === value)
  ) {
    throw new Error('avifgainmaputil did not produce a valid PNG')
  }
  const avifBytes = (await stat(avifPath)).size
  const pngBytes = (await stat(toneMappedPath)).size

  const probeSource = join(temporary, 'libavif-cicp-probe.c')
  const probeBinary = join(temporary, 'libavif-cicp-probe')
  await writeFile(
    probeSource,
    `#include <stdio.h>\n#include <avif/avif.h>\nint main(int argc, char **argv) {\n  if (argc != 2) return 2;\n  avifDecoder *decoder = avifDecoderCreate();\n  avifImage *image = avifImageCreateEmpty();\n  if (!decoder || !image) return 3;\n  decoder->imageContentToDecode = AVIF_IMAGE_CONTENT_ALL;\n  avifResult result = avifDecoderReadFile(decoder, image, argv[1]);\n  if (result != AVIF_RESULT_OK || !image->gainMap || !image->gainMap->image) {\n    fprintf(stderr, "%s\\n", avifResultToString(result));\n    return 4;\n  }\n  avifImage *gain = image->gainMap->image;\n  printf("libavif=%s base=%d/%d/%d/%d gain=%d/%d/%d/%d\\n", avifVersion(),\n         image->colorPrimaries, image->transferCharacteristics, image->matrixCoefficients, image->yuvRange,\n         gain->colorPrimaries, gain->transferCharacteristics, gain->matrixCoefficients, gain->yuvRange);\n  avifImageDestroy(image);\n  avifDecoderDestroy(decoder);\n  return 0;\n}\n`,
  )
  run('cc', ['-std=c11', '-I', libavifInclude, probeSource, libavifLibrary, '-o', probeBinary])
  const cicp = run(probeBinary, [avifPath]).stdout.trim()
  if (cicp !== 'libavif=1.3.0 base=1/13/1/1 gain=2/2/1/1') {
    throw new Error(`Pinned libavif CICP probe disagrees: ${cicp}`)
  }
  opened.close()

  console.log('HDR Surgery independent oracles passed')
  console.log(
    `libultrahdr: v2.0.0 metadata and RGBA16F decode; max error ${maximumError.toFixed(6)}, RMSE ${rmse.toFixed(6)}`,
  )
  console.log(
    `avifgainmaputil: 1.3.0 parsed ${avifBytes} byte AVIF and wrote ${pngBytes} byte tone-mapped PNG`,
  )
  console.log('iccDEV: 2.3.2.3+9f1707e validated standalone and embedded ICC v4.30 profiles')
  console.log('Little CMS: 2.16 opened both profiles and passed sRGB to XYZ round trips')
  console.log(`libavif CICP: ${cicp}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
