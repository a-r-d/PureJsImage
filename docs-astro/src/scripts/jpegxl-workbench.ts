import type { JpegXlWorkbenchPreview, JpegXlWorkbenchRequest } from './jpegxl-workbench-types.ts'
import { isJpegXlWorkbenchResponse } from './jpegxl-workbench-types.ts'

const element = (id: string): HTMLElement => {
  const value = document.getElementById(id)
  if (!value) throw new Error(`Missing #${id}`)
  return value
}

const button = (id: string): HTMLButtonElement => {
  const value = element(id)
  if (!(value instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`)
  return value
}

const canvas = element('jxl-preview')
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#jxl-preview is not a canvas')
const file = element('jxl-file')
if (!(file instanceof HTMLInputElement)) throw new Error('#jxl-file is not an input')

const status = element('jxl-status')
const summary = element('jxl-summary')
const details = element('jxl-details')
const worker = new Worker(new URL('./jpegxl-workbench-worker.js', import.meta.url), {
  type: 'module',
})
let nextRequestId = 0
let latestRequestId = 0
let generation = 0
let output: Readonly<{ name: string; bytes: ArrayBuffer }> | undefined

type WithoutIdentity<Request> = Request extends {
  readonly requestId: number
  readonly generation: number
}
  ? Omit<Request, 'requestId' | 'generation'>
  : never

const request = (
  value: WithoutIdentity<JpegXlWorkbenchRequest>,
  requestGeneration = generation,
): void => {
  latestRequestId = ++nextRequestId
  const message = {
    ...value,
    requestId: latestRequestId,
    generation: requestGeneration,
  } as JpegXlWorkbenchRequest
  if (message.type !== 'cancel') status.textContent = 'Working locally in a browser worker…'
  if (message.type === 'open') worker.postMessage(message, [message.bytes])
  else worker.postMessage(message)
}

const beginOpen = (): number => {
  generation += 1
  request({ type: 'cancel' }, generation)
  output = undefined
  button('jxl-download').disabled = true
  button('jxl-reopen').disabled = true
  return generation
}

const draw = (image: JpegXlWorkbenchPreview): void => {
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height),
    0,
    0,
  )
}

const rows = (values: readonly (readonly [string, string])[]): void => {
  summary.replaceChildren(
    ...values.map(([label, value]) => {
      const row = document.createElement('div')
      const term = document.createElement('dt')
      const description = document.createElement('dd')
      term.textContent = label
      description.textContent = value
      row.append(term, description)
      return row
    }),
  )
}

const openSample = async (name: string): Promise<void> => {
  const openGeneration = beginOpen()
  status.textContent = `Loading ${name}…`
  const response = await fetch(`/demo-data/${name}`)
  if (!response.ok) throw new Error(`Sample request failed with HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  if (openGeneration !== generation) return
  request({ type: 'open', name, bytes }, openGeneration)
}

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isJpegXlWorkbenchResponse(event.data)) {
    status.textContent = 'The JPEG XL worker returned an invalid response.'
    return
  }
  const response = event.data
  if (response.generation !== generation || response.requestId !== latestRequestId) return
  if (response.type === 'error') {
    status.textContent = response.message
    return
  }
  draw(response.preview)
  output = response.type === 'output' ? { name: response.name, bytes: response.bytes } : undefined
  button('jxl-download').disabled = output === undefined
  if (response.type === 'opened') {
    const exact = response.eligibility?.eligible
    const pixelInput = response.sourceKind === 'png' || response.sourceKind === 'tiff'
    rows([
      ['File', response.name],
      [
        'Input',
        response.sourceKind === 'jpeg'
          ? 'JPEG'
          : response.sourceKind === 'jpegxl'
            ? 'JPEG XL'
            : (response.pixelSource?.container ?? response.sourceKind.toUpperCase()),
      ],
      ['Bytes', response.inputBytes.toLocaleString()],
      ['Dimensions', `${response.preview.logicalWidth} × ${response.preview.logicalHeight}`],
      ...(response.pixelSource
        ? ([
            ['Pixel format', response.pixelSource.pixelFormat],
            [
              'Color and alpha',
              `${response.pixelSource.color}; alpha ${response.pixelSource.alpha}`,
            ],
            ['Encoder status', 'Experimental'],
          ] as const)
        : []),
      [
        'Preview',
        response.preview.scaled
          ? `${response.preview.width} × ${response.preview.height} scaled locally`
          : 'Full size',
      ],
      [
        'Exact reconstruction',
        response.sourceKind === 'jpeg'
          ? exact
            ? 'Eligible'
            : `Unavailable: ${response.eligibility?.reasons.join('; ') ?? 'unknown reason'}`
          : response.sourceKind === 'jpegxl'
            ? response.inspection?.jpegReconstruction === 'metadata-valid'
              ? 'Metadata present'
              : 'Unavailable'
            : 'Not applicable to pixel-lossless encode',
      ],
    ])
    details.textContent = JSON.stringify(
      response.inspection ?? response.eligibility ?? response.pixelSource,
      null,
      2,
    )
    button('jxl-transcode').disabled = response.sourceKind !== 'jpeg' || !exact
    button('jxl-encode').disabled = !pixelInput
    button('jxl-reconstruct').disabled =
      response.sourceKind !== 'jpegxl' ||
      response.inspection?.jpegReconstruction !== 'metadata-valid'
    status.textContent = `${response.name} inspected and decoded locally.`
    return
  }
  button('jxl-reopen').disabled = !response.name.endsWith('.jxl')
  if (response.action === 'encode') {
    rows([
      ['Output', response.name],
      ['Mode', 'Pixel-lossless encode'],
      ['Encoder status', response.encode?.status ?? 'Experimental'],
      ['Pixel format', response.encode?.sourcePixelFormat ?? 'unknown'],
      [
        'Decoded samples',
        response.encode?.exactDecodedSamples ? 'byte-exact local round trip' : 'Changed',
      ],
      ['JXL bytes', response.bytes.byteLength.toLocaleString()],
      [
        'Compression comparison',
        `${response.encode?.inputBytes.toLocaleString() ?? '0'} source bytes; ${response.encode?.outputToInputRatio.toFixed(3) ?? '0'}× output/source`,
      ],
      ['Dimensions', `${response.preview.logicalWidth} × ${response.preview.logicalHeight}`],
    ])
    details.textContent = JSON.stringify(
      { inspection: response.inspection, encode: response.encode },
      null,
      2,
    )
    button('jxl-reconstruct').disabled = true
    status.textContent = 'Pixel-lossless JPEG XL byte-exact local round trip verified.'
  } else if (response.action === 'transcode') {
    rows([
      ['Output', response.name],
      ['Mode', response.transcode?.mode ?? 'unknown'],
      ['Exact reconstruction', response.transcode?.exactReconstruction ? 'Verified' : 'No'],
      ['Bytes', response.bytes.byteLength.toLocaleString()],
      ['Dimensions', `${response.preview.logicalWidth} × ${response.preview.logicalHeight}`],
      ['Managed peak', (response.transcode?.managedPeakBytes ?? 0).toLocaleString()],
    ])
    details.textContent = JSON.stringify(
      {
        inspection: response.inspection,
        transcode: response.transcode,
        evidence: response.evidence,
      },
      null,
      2,
    )
    button('jxl-reconstruct').disabled = !response.transcode?.exactReconstruction
    status.textContent = 'Exact JPEG coefficient transcode verified locally.'
  } else {
    rows([
      ['Output', response.name],
      ['Mode', 'Exact JPEG reconstruction'],
      ['Bytes', response.bytes.byteLength.toLocaleString()],
      ['Dimensions', `${response.preview.logicalWidth} × ${response.preview.logicalHeight}`],
    ])
    details.textContent = JSON.stringify({ exactReconstruction: true }, null, 2)
    status.textContent = 'Original JPEG bytes reconstructed locally.'
  }
})

worker.addEventListener('error', (event) => {
  status.textContent = event.message
})

button('jxl-open-jpeg').addEventListener('click', () => {
  void openSample('jpegxl-progressive-yuv420.jpg').catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : 'Could not load JPEG sample'
  })
})
button('jxl-open-jxl').addEventListener('click', () => {
  void openSample('jpegxl-progressive-yuv420.jxl').catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : 'Could not load JPEG XL sample'
  })
})
button('jxl-open-png').addEventListener('click', () => {
  void openSample('jpegxl-pixel-lossless.png').catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : 'Could not load PNG sample'
  })
})
file.addEventListener('change', () => {
  const selected = file.files?.[0]
  if (!selected) return
  const openGeneration = beginOpen()
  void selected.arrayBuffer().then((bytes) => {
    if (openGeneration !== generation) return
    request({ type: 'open', name: selected.name, bytes }, openGeneration)
  })
})
button('jxl-transcode').addEventListener('click', () => request({ type: 'transcode' }))
button('jxl-encode').addEventListener('click', () => request({ type: 'encode' }))
button('jxl-reconstruct').addEventListener('click', () => request({ type: 'reconstruct' }))
button('jxl-reopen').addEventListener('click', () => {
  if (!output?.name.endsWith('.jxl')) return
  const latestOutput = output
  const openGeneration = beginOpen()
  request(
    { type: 'open', name: latestOutput.name, bytes: latestOutput.bytes.slice(0) },
    openGeneration,
  )
})
button('jxl-download').addEventListener('click', () => {
  if (!output) return
  const url = URL.createObjectURL(new Blob([output.bytes]))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = output.name
  anchor.click()
  URL.revokeObjectURL(url)
})

window.addEventListener('pagehide', () => {
  request({ type: 'cancel' })
  worker.terminate()
})

void openSample('jpegxl-progressive-yuv420.jpg').catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : 'Could not load JPEG sample'
})
