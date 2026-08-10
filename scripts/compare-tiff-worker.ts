import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { fromArrayBuffer } from 'geotiff'
import { decode as decodeImageJs } from 'image-js'
import { Jimp } from 'jimp'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import UTIF from 'utif'
import { createTiffCodec } from '../src/codecs/tiff.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import { ImageError } from '../src/errors.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import { pngCodec } from '../src/codecs/png.ts'

export const tiffCompetitorEngines = ['purejsimage', 'geotiff', 'utif', 'image-js', 'jimp'] as const
export type TiffCompetitorEngine = (typeof tiffCompetitorEngines)[number]

interface DecodedRgba {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export interface TiffCompetitorWorkerSuccess {
  readonly status: 'success'
  readonly width: number
  readonly height: number
  readonly exact: boolean
  readonly mismatchedPixels: number
  readonly maximumChannelDelta: number
  readonly rootMeanSquareError: number
  readonly decodeMilliseconds: number
}

export interface TiffCompetitorWorkerFailure {
  readonly status: 'unsupported' | 'error' | 'oracle-failure'
  readonly errorCode: string | null
  readonly errorMessage: string
}

export type TiffCompetitorWorkerResult = TiffCompetitorWorkerSuccess | TiffCompetitorWorkerFailure

const imageLibrary = createNodeImageLibrary([
  pngCodec,
  createTiffCodec({ embeddedCodecs: [webpCodec] }),
  webpCodec,
])

const checkedRgba = (
  width: number,
  height: number,
  data: Uint8Array,
  engine: string,
): DecodedRgba => {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error(`${engine} returned invalid dimensions`)
  }
  const expected = width * height * 4
  if (!Number.isSafeInteger(expected) || data.byteLength !== expected) {
    throw new Error(`${engine} returned ${data.byteLength} bytes for ${width}x${height} RGBA`)
  }
  return { width, height, data }
}

const decodePureJsImage = async (input: Uint8Array): Promise<DecodedRgba> => {
  const encoded = await (await imageLibrary.open(input)).png().toUint8Array()
  const png = PNG.sync.read(Buffer.from(encoded))
  return checkedRgba(png.width, png.height, new Uint8Array(png.data), 'PureJsImage')
}

const decodeGeoTiff = async (input: Uint8Array): Promise<DecodedRgba> => {
  const file = await fromArrayBuffer(input.slice().buffer)
  const image = await file.getImage(0)
  const rgb = await image.readRGB({ interleave: true })
  const width = image.getWidth()
  const height = image.getHeight()
  if (rgb.length !== width * height * 3) throw new Error('GeoTIFF.js returned invalid RGB size')
  const maximum =
    rgb instanceof Uint8Array || rgb instanceof Uint8ClampedArray
      ? 255
      : rgb instanceof Uint16Array
        ? 65_535
        : rgb instanceof Uint32Array
          ? 0xffff_ffff
          : null
  if (maximum === null) throw new Error('GeoTIFF.js returned non-unsigned RGB output')
  const byte = (value: number): number =>
    Math.max(0, Math.min(255, Math.round((value * 255) / maximum)))
  const rgba = new Uint8Array(width * height * 4)
  for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
    rgba[target] = byte(rgb[source] ?? 0)
    rgba[target + 1] = byte(rgb[source + 1] ?? 0)
    rgba[target + 2] = byte(rgb[source + 2] ?? 0)
    rgba[target + 3] = 255
  }
  return checkedRgba(width, height, rgba, 'GeoTIFF.js')
}

const decodeUtif = (input: Uint8Array): DecodedRgba => {
  const buffer = input.slice().buffer
  const ifd = UTIF.decode(buffer)[0]
  if (!ifd) throw new Error('UTIF.js found no image directory')
  UTIF.decodeImage(buffer, ifd)
  const width = ifd.width
  const height = ifd.height
  if (width === undefined || height === undefined) throw new Error('UTIF.js omitted dimensions')
  return checkedRgba(width, height, UTIF.toRGBA8(ifd), 'UTIF.js')
}

const decodeImageJsRgba = (input: Uint8Array): DecodedRgba => {
  let image = decodeImageJs(input)
  if (image.bitDepth !== 8) image = image.convertBitDepth(8)
  if (image.colorModel !== 'RGB') image = image.convertColor('RGB')
  const raw = image.getRawImage()
  const rgba = new Uint8Array(raw.width * raw.height * 4)
  for (let pixel = 0; pixel < raw.width * raw.height; pixel += 1) {
    const source = pixel * raw.channels
    const target = pixel * 4
    rgba[target] = raw.data[source] ?? 0
    rgba[target + 1] = raw.data[source + 1] ?? rgba[target]
    rgba[target + 2] = raw.data[source + 2] ?? rgba[target]
    rgba[target + 3] = image.alpha ? (raw.data[source + raw.channels - 1] ?? 255) : 255
  }
  return checkedRgba(raw.width, raw.height, rgba, 'image-js')
}

const decodeJimp = async (input: Uint8Array): Promise<DecodedRgba> => {
  const image = await Jimp.read(Buffer.from(input))
  return checkedRgba(
    image.bitmap.width,
    image.bitmap.height,
    new Uint8Array(image.bitmap.data),
    'Jimp',
  )
}

const decodeEngine = async (
  engine: TiffCompetitorEngine,
  input: Uint8Array,
): Promise<DecodedRgba> => {
  if (engine === 'purejsimage') return decodePureJsImage(input)
  if (engine === 'geotiff') return decodeGeoTiff(input)
  if (engine === 'utif') return decodeUtif(input)
  if (engine === 'image-js') return decodeImageJsRgba(input)
  return decodeJimp(input)
}

const magickOutput = (arguments_: readonly string[], maximumBytes: number): Promise<Uint8Array> =>
  new Promise((resolveOutput, reject) => {
    const child = spawn('magick', arguments_, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Uint8Array[] = []
    let bytes = 0
    let stderr = ''
    let exceeded = false
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > maximumBytes) {
        exceeded = true
        child.kill('SIGKILL')
      } else {
        chunks.push(chunk)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-500)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (exceeded) {
        reject(new Error(`ImageMagick output exceeds ${maximumBytes} bytes`))
      } else if (code !== 0) {
        reject(new Error(stderr.trim() || `ImageMagick exited with code ${String(code)}`))
      } else {
        resolveOutput(new Uint8Array(Buffer.concat(chunks)))
      }
    })
  })

const decodeImageMagick = async (file: string): Promise<DecodedRgba> => {
  const input = `${file}[0]`
  const dimensions = new TextDecoder().decode(
    await magickOutput(['identify', '-format', '%w %h', input], 1024),
  )
  const match = /^(?<width>\d+) (?<height>\d+)$/u.exec(dimensions)
  const width = Number(match?.groups?.width)
  const height = Number(match?.groups?.height)
  const expectedBytes = width * height * 4
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 4 || expectedBytes > 0x7fff_ffff) {
    throw new Error('ImageMagick returned invalid dimensions')
  }
  const data = await magickOutput([input, '-alpha', 'on', '-depth', '8', 'rgba:-'], expectedBytes)
  return checkedRgba(width, height, data, 'ImageMagick oracle')
}

const decodeOracle = async (input: Uint8Array, file: string): Promise<DecodedRgba> => {
  try {
    const result = await sharp(input, { failOn: 'error' }).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    })
    return checkedRgba(
      result.info.width,
      result.info.height,
      new Uint8Array(result.data),
      'sharp oracle',
    )
  } catch (sharpError) {
    try {
      return await decodeImageMagick(file)
    } catch (magickError) {
      throw new Error(
        `sharp: ${errorMessage(sharpError)}; ImageMagick: ${errorMessage(magickError)}`,
      )
    }
  }
}

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/gu, ' ').slice(0, 500)

export const compareTiffFile = async (
  engine: TiffCompetitorEngine,
  file: string,
): Promise<TiffCompetitorWorkerResult> => {
  const input = new Uint8Array(await readFile(file))
  let oracle: DecodedRgba
  try {
    oracle = await decodeOracle(input, file)
  } catch (error) {
    return { status: 'oracle-failure', errorCode: null, errorMessage: errorMessage(error) }
  }

  try {
    const started = performance.now()
    const decoded = await decodeEngine(engine, input)
    const decodeMilliseconds = performance.now() - started
    if (decoded.width !== oracle.width || decoded.height !== oracle.height) {
      return {
        status: 'error',
        errorCode: null,
        errorMessage: `dimension mismatch: ${decoded.width}x${decoded.height} versus oracle ${oracle.width}x${oracle.height}`,
      }
    }
    let mismatchedPixels = 0
    let maximumChannelDelta = 0
    let squaredError = 0
    for (let pixel = 0; pixel < oracle.width * oracle.height; pixel += 1) {
      let pixelMismatch = false
      for (let channel = 0; channel < 4; channel += 1) {
        const index = pixel * 4 + channel
        const delta = Math.abs((decoded.data[index] ?? 0) - (oracle.data[index] ?? 0))
        if (delta !== 0) pixelMismatch = true
        if (delta > maximumChannelDelta) maximumChannelDelta = delta
        squaredError += delta * delta
      }
      if (pixelMismatch) mismatchedPixels += 1
    }
    return {
      status: 'success',
      width: oracle.width,
      height: oracle.height,
      exact: mismatchedPixels === 0,
      mismatchedPixels,
      maximumChannelDelta,
      rootMeanSquareError: Math.sqrt(squaredError / oracle.data.byteLength),
      decodeMilliseconds,
    }
  } catch (error) {
    return {
      status:
        error instanceof ImageError && error.code === 'UNSUPPORTED_OPERATION'
          ? 'unsupported'
          : 'error',
      errorCode: error instanceof ImageError ? error.code : null,
      errorMessage: errorMessage(error),
    }
  }
}

const parseEngine = (value: string | undefined): TiffCompetitorEngine => {
  const engine = tiffCompetitorEngines.find((candidate) => candidate === value)
  if (!engine) throw new Error(`--engine must be one of ${tiffCompetitorEngines.join(', ')}`)
  return engine
}

const run = async (): Promise<void> => {
  const engineIndex = process.argv.indexOf('--engine')
  const fileIndex = process.argv.indexOf('--file')
  const engine = parseEngine(process.argv[engineIndex + 1])
  const file = process.argv[fileIndex + 1]
  if (!file) throw new Error('--file requires a path')
  process.stdout.write(`${JSON.stringify(await compareTiffFile(engine, file))}\n`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await run()
