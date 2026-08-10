import { pathToFileURL } from 'node:url'

import { bmpCodec } from '../src/codecs/bmp.ts'
import { gifCodec } from '../src/codecs/gif.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { tiffCodec } from '../src/codecs/tiff.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import { ImageError } from '../src/errors.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import { type ImazenFormat, imazenFormats, isImazenFormat } from './validate-imazen-corpus.ts'

export type ImazenWorkerStage =
  | 'start'
  | 'open'
  | 'metadata'
  | 'decode-and-encode-png'
  | 'reopen-png'
  | 'output-metadata'
  | 'verify-output'
export type ImazenWorkerFailureKind = 'structured-error' | 'raw-exception' | 'invalid-output'

export type ImazenWorkerMessage =
  | {
      readonly status: 'success'
      readonly lastCompletedStage: 'verify-output'
      readonly width: number
      readonly height: number
    }
  | {
      readonly status: 'failure'
      readonly failureKind: ImazenWorkerFailureKind
      readonly lastCompletedStage: ImazenWorkerStage
      readonly errorCode: string | null
      readonly errorMessage: string
    }

interface WorkerOptions {
  readonly file: string
  readonly format: ImazenFormat
}

const imageLibrary = createNodeImageLibrary([
  jpegCodec,
  pngCodec,
  webpCodec,
  tiffCodec,
  gifCodec,
  bmpCodec,
])
const stagePrefix = 'PUREJSIMAGE_IMAZEN_STAGE '

const argumentValue = (arguments_: readonly string[], index: number, name: string): string => {
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const parseOptions = (arguments_: readonly string[]): WorkerOptions => {
  let file: string | undefined
  let format: ImazenFormat | undefined
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--file') {
      file = argumentValue(arguments_, index, argument)
      index += 1
    } else if (argument === '--format') {
      const value = argumentValue(arguments_, index, argument)
      if (!isImazenFormat(value)) {
        throw new Error(`--format must be one of ${imazenFormats.join(', ')}`)
      }
      format = value
      index += 1
    } else {
      throw new Error(`Unknown worker option: ${argument ?? '<missing>'}`)
    }
  }
  if (!file || !format) throw new Error('Worker requires --file and --format')
  return { file, format }
}

const sanitize = (message: string, file: string): string =>
  message
    .replaceAll(file, '<corpus-file>')
    .replaceAll(process.cwd(), '<repository>')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500)

const failureMessage = (
  failureKind: ImazenWorkerFailureKind,
  lastCompletedStage: ImazenWorkerStage,
  error: unknown,
  file: string,
): ImazenWorkerMessage => {
  const structured = error instanceof ImageError
  const rawMessage = error instanceof Error ? error.message : String(error)
  return {
    status: 'failure',
    failureKind,
    lastCompletedStage,
    errorCode: structured ? error.code : null,
    errorMessage: sanitize(rawMessage, file) || 'Unknown worker failure',
  }
}

export const validateImage = async (options: WorkerOptions): Promise<ImazenWorkerMessage> => {
  let lastCompletedStage: ImazenWorkerStage = 'start'
  try {
    const image = await imageLibrary.open(
      options.file,
      options.format === 'gif' ? { frame: 0 } : {},
    )
    lastCompletedStage = 'open'
    process.stderr.write(`${stagePrefix}${lastCompletedStage}\n`)

    const metadata = await image.metadata()
    lastCompletedStage = 'metadata'
    process.stderr.write(`${stagePrefix}${lastCompletedStage}\n`)
    if (metadata.format !== options.format) {
      return failureMessage(
        'invalid-output',
        lastCompletedStage,
        new Error(`Expected ${options.format} input metadata, received ${metadata.format}`),
        options.file,
      )
    }

    const encoded = await image.png().toBuffer()
    lastCompletedStage = 'decode-and-encode-png'
    process.stderr.write(`${stagePrefix}${lastCompletedStage}\n`)

    const reopened = await imageLibrary.open(encoded)
    lastCompletedStage = 'reopen-png'
    process.stderr.write(`${stagePrefix}${lastCompletedStage}\n`)
    const outputMetadata = await reopened.metadata()
    lastCompletedStage = 'output-metadata'
    process.stderr.write(`${stagePrefix}${lastCompletedStage}\n`)
    if (
      outputMetadata.format !== 'png' ||
      outputMetadata.width !== metadata.width ||
      outputMetadata.height !== metadata.height
    ) {
      return failureMessage(
        'invalid-output',
        lastCompletedStage,
        new Error(
          `Expected PNG ${metadata.width}x${metadata.height}, received ${outputMetadata.format} ${outputMetadata.width}x${outputMetadata.height}`,
        ),
        options.file,
      )
    }

    await reopened.png().toBuffer()
    lastCompletedStage = 'verify-output'
    process.stderr.write(`${stagePrefix}${lastCompletedStage}\n`)
    return {
      status: 'success',
      lastCompletedStage,
      width: metadata.width,
      height: metadata.height,
    }
  } catch (error) {
    const outputFailure =
      lastCompletedStage === 'decode-and-encode-png' ||
      lastCompletedStage === 'reopen-png' ||
      lastCompletedStage === 'output-metadata'
    return failureMessage(
      outputFailure
        ? 'invalid-output'
        : error instanceof ImageError
          ? 'structured-error'
          : 'raw-exception',
      lastCompletedStage,
      error,
      options.file,
    )
  }
}

const runCli = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2))
  const result = await validateImage(options)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runCli()
