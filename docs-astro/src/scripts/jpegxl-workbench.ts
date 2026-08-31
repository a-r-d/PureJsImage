import type {
  JpegXlWorkbenchPreview,
  JpegXlWorkbenchRequest,
  JpegXlWorkbenchResponse,
} from './jpegxl-workbench-types.ts'

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
let output: Readonly<{ name: string; bytes: ArrayBuffer }> | undefined

type WithoutRequestId<Request> = Request extends { readonly requestId: number }
  ? Omit<Request, 'requestId'>
  : never

const request = (value: WithoutRequestId<JpegXlWorkbenchRequest>): void => {
  latestRequestId = ++nextRequestId
  const message = { ...value, requestId: latestRequestId } as JpegXlWorkbenchRequest
  status.textContent = 'Working locally in a browser worker…'
  if (message.type === 'open') worker.postMessage(message, [message.bytes])
  else worker.postMessage(message)
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
  status.textContent = `Loading ${name}…`
  const response = await fetch(`/demo-data/${name}`)
  if (!response.ok) throw new Error(`Sample request failed with HTTP ${response.status}`)
  request({ type: 'open', name, bytes: await response.arrayBuffer() })
}

worker.addEventListener('message', (event: MessageEvent<JpegXlWorkbenchResponse>) => {
  const response = event.data
  if (response.requestId !== latestRequestId) return
  if (response.type === 'error') {
    status.textContent = response.message
    return
  }
  draw(response.preview)
  output = response.type === 'output' ? { name: response.name, bytes: response.bytes } : undefined
  button('jxl-download').disabled = output === undefined
  if (response.type === 'opened') {
    const exact = response.eligibility?.eligible
    rows([
      ['File', response.name],
      ['Input', response.sourceKind === 'jpeg' ? 'JPEG' : 'JPEG XL'],
      ['Bytes', response.inputBytes.toLocaleString()],
      ['Dimensions', `${response.preview.width} × ${response.preview.height}`],
      [
        'Exact reconstruction',
        response.sourceKind === 'jpeg'
          ? exact
            ? 'Eligible'
            : `Unavailable: ${response.eligibility?.reasons.join('; ') ?? 'unknown reason'}`
          : response.inspection?.jpegReconstruction === 'metadata-valid'
            ? 'Metadata present'
            : 'Unavailable',
      ],
    ])
    details.textContent = JSON.stringify(response.inspection ?? response.eligibility, null, 2)
    button('jxl-transcode').disabled = response.sourceKind !== 'jpeg' || !exact
    button('jxl-reconstruct').disabled =
      response.sourceKind !== 'jpegxl' ||
      response.inspection?.jpegReconstruction !== 'metadata-valid'
    status.textContent = `${response.name} inspected and decoded locally.`
    return
  }
  if (response.action === 'transcode') {
    rows([
      ['Output', response.name],
      ['Mode', response.transcode?.mode ?? 'unknown'],
      ['Exact reconstruction', response.transcode?.exactReconstruction ? 'Verified' : 'No'],
      ['Bytes', response.bytes.byteLength.toLocaleString()],
      ['Dimensions', `${response.preview.width} × ${response.preview.height}`],
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
      ['Dimensions', `${response.preview.width} × ${response.preview.height}`],
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
file.addEventListener('change', () => {
  const selected = file.files?.[0]
  if (!selected) return
  void selected.arrayBuffer().then((bytes) => request({ type: 'open', name: selected.name, bytes }))
})
button('jxl-transcode').addEventListener('click', () => request({ type: 'transcode' }))
button('jxl-reconstruct').addEventListener('click', () => request({ type: 'reconstruct' }))
button('jxl-download').addEventListener('click', () => {
  if (!output) return
  const url = URL.createObjectURL(new Blob([output.bytes]))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = output.name
  anchor.click()
  URL.revokeObjectURL(url)
})

void openSample('jpegxl-progressive-yuv420.jpg').catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : 'Could not load JPEG sample'
})
