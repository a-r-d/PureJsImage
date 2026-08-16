import { fromArrayBuffer } from 'geotiff'
import { decode as decodeTiff } from 'tiff'
import UTIF from 'utif2'
import { decode as decodeImageJs } from 'image-js'
import * as nifti from 'nifti-reader-js'
import { parse as parseNpy } from 'npyjs'
import { File as JsFiveFile } from 'jsfive'
import h5wasm, { FS } from 'h5wasm'
import { readImage, setPipelineWorkerUrl, setPipelinesBaseUrl } from '@itk-wasm/image-io'
import type {
  ScientificCompetitorBrowserHarness,
  ScientificCompetitorBrowserReport,
  ScientificCompetitorBrowserRow,
} from '../../browser-tests/types.ts'

interface RawResult {
  readonly shape: readonly number[] | null
  readonly nativeSampleType: string | null
  readonly sampleBytes: Uint8Array | null
  readonly sampleCount: number | null
  readonly outputBytes: number
  readonly inputCopyBytes: number
  readonly inputBridgeMilliseconds: number
  readonly outputTransferMilliseconds: number
  readonly wasmInitializationMilliseconds: number
}

const now = (): number => performance.now()

const bytesOfView = (value: ArrayBufferView): Uint8Array =>
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

const nativeSampleType = (value: ArrayBufferView): string => {
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) return 'uint8'
  if (value instanceof Int8Array) return 'int8'
  if (value instanceof Uint16Array) return 'uint16'
  if (value instanceof Int16Array) return 'int16'
  if (value instanceof Uint32Array) return 'uint32'
  if (value instanceof Int32Array) return 'int32'
  if (value instanceof Float32Array) return 'float32'
  if (value instanceof Float64Array) return 'float64'
  return 'data-view'
}

const fromView = (
  value: ArrayBufferView,
  shape: readonly number[] | null,
  inputCopyBytes = 0,
  inputBridgeMilliseconds = 0,
  outputTransferMilliseconds = 0,
  wasmInitializationMilliseconds = 0,
): RawResult => {
  const bytes = bytesOfView(value).slice()
  return {
    shape,
    nativeSampleType: nativeSampleType(value),
    sampleBytes: bytes,
    sampleCount: value.byteLength,
    outputBytes: value.byteLength,
    inputCopyBytes,
    inputBridgeMilliseconds,
    outputTransferMilliseconds,
    wasmInitializationMilliseconds,
  }
}

const flattenNumbers = (value: unknown, output: number[] = []): number[] => {
  if (typeof value === 'number') {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const child of value) flattenNumbers(child, output)
    return output
  }
  throw new Error('Browser competitor returned non-numeric values')
}

const fromNumbers = (
  value: unknown,
  shape: readonly number[] | null,
  inputCopyBytes: number,
  inputBridgeMilliseconds = 0,
): RawResult => {
  const numbers = flattenNumbers(value)
  const typed = Int32Array.from(numbers)
  return fromView(typed, shape, inputCopyBytes, inputBridgeMilliseconds)
}

const inputUrl = (name: string): string => `/fixtures/scientific/${name}`

const inputNames = [
  'volume.nii',
  'volume.nii.gz',
  'array-c.npy',
  'array-f.npy',
  'array.nrrd',
  'array-gzip.nrrd',
  'image.mha',
  'volume.mrc',
  'image.ome.tiff',
  'ordinary.tiff',
  'layout.h5',
] as const

const inputFor = (inputs: ReadonlyMap<string, ArrayBuffer>, name: string): ArrayBuffer => {
  const input = inputs.get(name)
  if (input === undefined) throw new Error(`Missing browser fixture ${name}`)
  return input.slice(0)
}

const geotiffRead = async (input: ArrayBuffer, selected: boolean): Promise<RawResult> => {
  const document = await fromArrayBuffer(input)
  const image = await document.getImage()
  if (!selected) {
    return {
      shape: [image.getWidth(), image.getHeight()],
      nativeSampleType: null,
      sampleBytes: null,
      sampleCount: null,
      outputBytes: 0,
      inputCopyBytes: 0,
      inputBridgeMilliseconds: 0,
      outputTransferMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
    }
  }
  const width = Math.min(64, image.getWidth())
  const height = Math.min(48, image.getHeight())
  const raster = await image.readRasters({ window: [0, 0, width, height], interleave: true })
  if (!ArrayBuffer.isView(raster)) throw new Error('GeoTIFF browser result was not typed')
  return fromView(raster, [width, height])
}

const niftiRead = async (input: ArrayBuffer, selected: boolean): Promise<RawResult> => {
  const inputCopyBytes = input.byteLength
  const copied = input.slice(0)
  const uncompressed = nifti.isCompressed(copied) ? await nifti.decompressAsync(copied) : copied
  const header = nifti.readHeader(uncompressed)
  const count = header.dims[0] ?? 0
  const shape = header.dims.slice(1, count + 1)
  if (!selected && shape.length === 0) throw new Error('NIfTI browser header omitted shape')
  const image = nifti.readImage(header, uncompressed)
  const output = new Int16Array(image)
  return fromView(output, shape, inputCopyBytes)
}

const ensureH5 = async (): Promise<number> => {
  const started = now()
  await h5wasm.ready
  return now() - started
}

const h5Read = async (input: ArrayBuffer, selected: boolean): Promise<RawResult> => {
  if (FS === null) throw new Error('h5wasm browser FS is not initialized')
  const wasmInitializationMilliseconds = await ensureH5()
  const bridgeStarted = now()
  const path = `/tmp/browser-scientific-${selected ? 'selected' : 'full'}.h5`
  const copied = new Uint8Array(input.slice(0))
  FS.writeFile(path, copied)
  const inputBridgeMilliseconds = now() - bridgeStarted
  const file = new h5wasm.File(path, 'r')
  try {
    const dataset = file.get('dset_chunk')
    if (!(dataset instanceof h5wasm.Dataset))
      throw new Error('h5wasm browser dataset was not found')
    const output = selected
      ? dataset.slice([
          [0, 2],
          [0, 3],
        ])
      : dataset.value
    if (output === null) throw new Error('h5wasm browser returned no dataset data')
    const result = ArrayBuffer.isView(output)
      ? fromView(
          output,
          selected ? [2, 3] : (dataset.shape ?? []),
          input.byteLength,
          inputBridgeMilliseconds,
          0,
          wasmInitializationMilliseconds,
        )
      : fromNumbers(
          output,
          selected ? [2, 3] : (dataset.shape ?? []),
          input.byteLength,
          inputBridgeMilliseconds,
        )
    return { ...result, wasmInitializationMilliseconds }
  } finally {
    file.close()
    try {
      FS.unlink(path)
    } catch {
      // The browser FS may already have reclaimed the temporary file.
    }
  }
}

const itkRead = async (
  input: ArrayBuffer,
  name: string,
  informationOnly: boolean,
): Promise<RawResult> => {
  const bridgeStarted = now()
  const file = new File([input.slice(0)], name)
  const inputBridgeMilliseconds = now() - bridgeStarted
  const result = await readImage(file, { webWorker: false, informationOnly })
  const image = result.image
  if (informationOnly || image.data === null) {
    return {
      shape: image.size,
      nativeSampleType: null,
      sampleBytes: null,
      sampleCount: null,
      outputBytes: 0,
      inputCopyBytes: input.byteLength,
      inputBridgeMilliseconds,
      outputTransferMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
    }
  }
  const transferStarted = now()
  const output = bytesOfView(image.data).slice()
  const outputTransferMilliseconds = now() - transferStarted
  return {
    ...fromView(
      image.data,
      image.size,
      input.byteLength,
      inputBridgeMilliseconds,
      outputTransferMilliseconds,
    ),
    sampleBytes: output,
  }
}

const unsupported = (
  engine: string,
  workload: string,
  reason: string,
): ScientificCompetitorBrowserRow => ({
  engine,
  workload,
  status: 'unsupported',
  statusReason: reason,
  moduleInitializationMilliseconds: 0,
  wasmInitializationMilliseconds: 0,
  inputBridgeMilliseconds: 0,
  imageReadMilliseconds: 0,
  outputTransferMilliseconds: 0,
  cleanupMilliseconds: 0,
  firstUsableDataMilliseconds: null,
  totalWallMilliseconds: 0,
  sourceBytes: 0,
  requiredInputCopyBytes: 0,
  outputBytes: 0,
  sampleSha256: null,
  shape: null,
  nativeSampleType: null,
})

const runSupported = async (
  engine: string,
  workload: string,
  input: ArrayBuffer,
  execute: () => Promise<RawResult>,
): Promise<ScientificCompetitorBrowserRow> => {
  const started = now()
  try {
    const result = await execute()
    if (result.sampleBytes !== null && result.sampleBytes.byteLength === 0) {
      throw new Error('empty native output')
    }
    let digest: ArrayBuffer | null = null
    if (result.sampleBytes !== null) {
      const hashInput = new ArrayBuffer(result.sampleBytes.byteLength)
      new Uint8Array(hashInput).set(result.sampleBytes)
      digest = await crypto.subtle.digest('SHA-256', hashInput)
    }
    const sampleSha256 =
      digest === null
        ? null
        : [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
    const firstUsableDataMilliseconds = now() - started
    return {
      engine,
      workload,
      status: 'supported',
      statusReason: null,
      moduleInitializationMilliseconds: 0,
      wasmInitializationMilliseconds: result.wasmInitializationMilliseconds,
      inputBridgeMilliseconds: result.inputBridgeMilliseconds,
      imageReadMilliseconds: firstUsableDataMilliseconds,
      outputTransferMilliseconds: result.outputTransferMilliseconds,
      cleanupMilliseconds: 0,
      firstUsableDataMilliseconds,
      totalWallMilliseconds: now() - started,
      sourceBytes: input.byteLength,
      requiredInputCopyBytes: result.inputCopyBytes,
      outputBytes: result.outputBytes,
      sampleSha256,
      shape: result.shape,
      nativeSampleType: result.nativeSampleType,
    }
  } catch (error) {
    return {
      ...unsupported(engine, workload, error instanceof Error ? error.message : String(error)),
      status: 'error',
    }
  }
}

const run = async (): Promise<ScientificCompetitorBrowserReport> => {
  setPipelinesBaseUrl(new URL('/fixtures/scientific/pipelines/', location.origin))
  setPipelineWorkerUrl(null)
  const inputs = new Map<string, ArrayBuffer>()
  for (const name of inputNames) {
    const response = await fetch(inputUrl(name))
    if (!response.ok) throw new Error(`Could not fetch browser fixture ${name}`)
    inputs.set(name, await response.arrayBuffer())
  }
  const rows: ScientificCompetitorBrowserRow[] = []
  rows.push(
    await runSupported('geotiff', 'tiff-metadata', inputFor(inputs, 'ordinary.tiff'), () =>
      geotiffRead(inputFor(inputs, 'ordinary.tiff'), false),
    ),
  )
  rows.push(
    await runSupported('geotiff', 'tiff-window', inputFor(inputs, 'ordinary.tiff'), () =>
      geotiffRead(inputFor(inputs, 'ordinary.tiff'), true),
    ),
  )
  rows.push(
    await runSupported('tiff', 'tiff-full-decode', inputFor(inputs, 'ordinary.tiff'), async () => {
      const pages = decodeTiff(new Uint8Array(inputFor(inputs, 'ordinary.tiff')))
      const page = pages[0]
      if (page === undefined || page.data === undefined)
        throw new Error('tiff browser returned no data')
      return fromView(page.data, [page.width, page.height, page.components])
    }),
  )
  rows.push(
    await runSupported('utif2', 'tiff-full-decode', inputFor(inputs, 'ordinary.tiff'), async () => {
      const copied = inputFor(inputs, 'ordinary.tiff')
      const pages = UTIF.decode(copied)
      const page = pages[0]
      if (page === undefined) throw new Error('UTIF2 browser returned no page')
      UTIF.decodeImage(copied, page)
      if (page.data === undefined) throw new Error('UTIF2 browser returned no native data')
      return fromView(page.data, [page.width ?? 0, page.height ?? 0])
    }),
  )
  rows.push(
    await runSupported(
      'image-js',
      'tiff-full-decode',
      inputFor(inputs, 'ordinary.tiff'),
      async () => {
        const image = decodeImageJs(new Uint8Array(inputFor(inputs, 'ordinary.tiff')))
        const raw = image.getRawImage()
        return fromView(raw.data, [raw.width, raw.height, raw.channels])
      },
    ),
  )
  rows.push(
    await runSupported('nifti-reader-js', 'nifti-full', inputFor(inputs, 'volume.nii'), () =>
      niftiRead(inputFor(inputs, 'volume.nii'), false),
    ),
  )
  rows.push(
    await runSupported(
      'nifti-reader-js',
      'nifti-gzip-full',
      inputFor(inputs, 'volume.nii.gz'),
      () => niftiRead(inputFor(inputs, 'volume.nii.gz'), false),
    ),
  )
  rows.push(
    await runSupported('npyjs', 'npy-c-full', inputFor(inputs, 'array-c.npy'), async () => {
      const input = inputFor(inputs, 'array-c.npy')
      const array = parseNpy(input.slice(0))
      return fromView(array.data, array.shape, input.byteLength)
    }),
  )
  rows.push(
    await runSupported('npyjs', 'npy-fortran-full', inputFor(inputs, 'array-f.npy'), async () => {
      const input = inputFor(inputs, 'array-f.npy')
      const array = parseNpy(input.slice(0))
      return fromView(array.data, array.shape, input.byteLength)
    }),
  )
  rows.push(
    await runSupported('jsfive', 'hdf5-hierarchy', inputFor(inputs, 'layout.h5'), async () => {
      const input = inputFor(inputs, 'layout.h5')
      const file = new JsFiveFile(input.slice(0), 'layout.h5')
      const keys = file.keys
      if (keys.length === 0) throw new Error('jsfive browser returned empty hierarchy')
      return {
        shape: null,
        nativeSampleType: null,
        sampleBytes: new Uint8Array([keys.length]),
        sampleCount: keys.length,
        outputBytes: 0,
        inputCopyBytes: input.byteLength,
        inputBridgeMilliseconds: 0,
        outputTransferMilliseconds: 0,
        wasmInitializationMilliseconds: 0,
      }
    }),
  )
  rows.push(
    await runSupported(
      'jsfive',
      'hdf5-contiguous-full',
      inputFor(inputs, 'layout.h5'),
      async () => {
        const input = inputFor(inputs, 'layout.h5')
        const file = new JsFiveFile(input.slice(0), 'layout.h5')
        const dataset = file.get('dset_contiguous')
        if (dataset === null) throw new Error('jsfive browser dataset missing')
        return fromNumbers(dataset.value, dataset.shape, input.byteLength)
      },
    ),
  )
  rows.push(
    await runSupported('h5wasm', 'hdf5-chunked-selected', inputFor(inputs, 'layout.h5'), () =>
      h5Read(inputFor(inputs, 'layout.h5'), true),
    ),
  )
  rows.push(
    await runSupported('itk-wasm-image-io', 'nifti-full', inputFor(inputs, 'volume.nii'), () =>
      itkRead(inputFor(inputs, 'volume.nii'), 'volume.nii', false),
    ),
  )
  rows.push(
    await runSupported('itk-wasm-image-io', 'nrrd-full', inputFor(inputs, 'array.nrrd'), () =>
      itkRead(inputFor(inputs, 'array.nrrd'), 'array.nrrd', false),
    ),
  )
  rows.push(
    await runSupported(
      'itk-wasm-image-io',
      'meta-image-mha-full',
      inputFor(inputs, 'image.mha'),
      () => itkRead(inputFor(inputs, 'image.mha'), 'image.mha', false),
    ),
  )
  rows.push(
    await runSupported('itk-wasm-image-io', 'mrc-full', inputFor(inputs, 'volume.mrc'), () =>
      itkRead(inputFor(inputs, 'volume.mrc'), 'volume.mrc', false),
    ),
  )
  rows.push(
    await runSupported(
      'itk-wasm-image-io',
      'medical-tiff-full',
      inputFor(inputs, 'ordinary.tiff'),
      () => itkRead(inputFor(inputs, 'ordinary.tiff'), 'ordinary.tiff', false),
    ),
  )
  rows.push(unsupported('geotiff', 'npy-c-full', 'GeoTIFF accepts TIFF sources only.'))
  rows.push(
    unsupported(
      'nifti-reader-js',
      'tiff-full-decode',
      'nifti-reader-js accepts NIfTI sources only.',
    ),
  )
  rows.push(
    unsupported('h5wasm', 'nifti-full', 'h5wasm accepts HDF5 through its virtual filesystem only.'),
  )
  return {
    browser: navigator.userAgent,
    generatedAt: new Date().toISOString(),
    note: 'Chromium is measured separately from Node. Inputs are fetched once and passed as identical in-memory ArrayBuffers; validation and sample hashing are outside the timed read operation. ITK-Wasm browser rows use its public readImage API with webWorker:false and a local pipeline asset base URL.',
    rows,
  }
}

const harness: ScientificCompetitorBrowserHarness = Object.freeze({ run })
window.pureJsImageScientificCompetitors = harness
