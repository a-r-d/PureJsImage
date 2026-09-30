import { isJxlToolResponse, type JxlToolRequest, record, toolNames } from './jpegxl-tool-types.ts'
import { JxlWorkerClient } from './jpegxl-worker-client.ts'

const element = (id: string) => {
  const e = document.getElementById(id)
  if (!e) throw new Error(`Missing ${id}`)
  return e
}
const input = (id: string) => {
  const e = element(id)
  if (!(e instanceof HTMLInputElement)) throw new Error(`Missing input ${id}`)
  return e
}
const select = (id: string) => {
  const e = element(id)
  if (!(e instanceof HTMLSelectElement)) throw new Error(`Missing select ${id}`)
  return e
}
const button = (id: string) => {
  const e = element(id)
  if (!(e instanceof HTMLButtonElement)) throw new Error(`Missing button ${id}`)
  return e
}
const root = element('jxl-tool'),
  tool = toolNames.find((t) => t === root.dataset.tool)
if (!tool) throw new Error('Unknown JPEG XL tool')
const status = element('tool-status'),
  details = element('tool-details'),
  summary = element('tool-summary'),
  stages = element('tool-stages')
const canvasElement = (id: string): HTMLCanvasElement => {
  const e = element(id)
  if (!(e instanceof HTMLCanvasElement)) throw new Error('Missing canvas')
  return e
}
const canvas = canvasElement('tool-canvas'),
  range = canvasElement('tool-ranges')
let file: File | undefined,
  files: File[] = [],
  output: { bytes: ArrayBuffer; name: string } | undefined,
  downloadUrl: string | undefined
let fetching: AbortController | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  playing = false,
  loop = 0,
  frameCount = 0
let busy = false
const disposeOutput = () => {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl)
  downloadUrl = undefined
  output = undefined
  button('tool-download').disabled = true
  button('tool-reopen').disabled = true
}
const stop = () => {
  playing = false
  clearTimeout(timer)
  button('tool-play').textContent = 'Play'
}
const client = new JxlWorkerClient(receive, (message) => {
  busy = false
  stop()
  status.textContent = message
})
const reset = () => {
  fetching?.abort()
  client.reset()
  busy = false
  stop()
  disposeOutput()
  stages.replaceChildren()
}
function options(): Record<string, unknown> {
  return {
    scale: Number(select('tool-scale').value),
    zoom: input('tool-zoom').valueAsNumber,
    x: input('tool-x').valueAsNumber,
    y: input('tool-y').valueAsNumber,
    frame: input('tool-frame').valueAsNumber,
    plane: Number(select('tool-plane').value),
    white: input('tool-white').valueAsNumber,
    sampleX: input('tool-sample-x').valueAsNumber,
    sampleY: input('tool-sample-y').valueAsNumber,
    duration: input('tool-duration').valueAsNumber,
    loops: input('tool-loops').valueAsNumber,
    lossy: input('tool-lossy').checked,
    distance: input('tool-distance').valueAsNumber,
  }
}
function run(action = 'open') {
  if (busy) {
    client.reset()
    busy = false
  }
  busy = true
  const request: JxlToolRequest = {
    type: 'tool',
    tool: tool ?? 'native',
    action,
    generation: client.generation,
    requestId: ++client.requestId,
    options: options(),
    ...(file ? { file } : {}),
    ...(files.length ? { files } : {}),
    ...(!file && input('tool-url').value ? { url: input('tool-url').value.trim() } : {}),
  }
  status.textContent = 'Working locally in a browser worker…'
  client.post(request)
}
function receive(value: unknown) {
  if (
    !record(value) ||
    typeof value.requestId !== 'number' ||
    typeof value.generation !== 'number' ||
    !client.current({ requestId: value.requestId, generation: value.generation })
  )
    return
  if (value.type === 'error') {
    busy = false
    stop()
    status.textContent = typeof value.message === 'string' ? value.message : 'Operation failed'
    return
  }
  if (!isJxlToolResponse(value)) {
    busy = false
    stop()
    status.textContent = 'Invalid worker response'
    return
  }
  status.textContent = value.message
  const info = value.info
  if (Object.keys(info).length) {
    details.textContent = JSON.stringify(info, null, 2)
    summary.textContent = [
      info.width ? `${info.width} × ${info.height}` : '',
      info.sampleFormat ? `${info.sampleFormat}, ${info.bitDepth} bits` : '',
      info.sample && record(info.sample)
        ? `Sample (${info.sample.x}, ${info.sample.y}): ${info.sample.value}; ${info.sample.rawBits}`
        : '',
      info.sourceBytes
        ? `Source ${info.sourceBytes} bytes; read ${info.sourceReadBytes ?? 0}; HTTP ${info.httpTransferBytes ?? 'unavailable'}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (value.image) {
    const c = canvas.getContext('2d')
    if (c) {
      canvas.width = value.image.width
      canvas.height = value.image.height
      c.putImageData(
        new ImageData(new Uint8ClampedArray(value.image.rgba), canvas.width, canvas.height),
        0,
        0,
      )
    }
  }
  if (value.state === 'stage') {
    const item = document.createElement('li')
    item.textContent = `${value.message}: ${info.sourceReadBytes} source bytes read; ${info.elapsedMs} ms`
    stages.append(item)
    if (Array.isArray(info.ranges)) {
      const c = range.getContext('2d')
      c?.clearRect(0, 0, range.width, range.height)
      info.ranges.forEach((n, i) => {
        if (c && typeof n === 'number' && n > 0) {
          c.fillStyle = n > 1 ? '#c46820' : '#17878b'
          c.fillRect((i * range.width) / 256, 0, range.width / 256, range.height)
        }
      })
    }
  }
  if (Array.isArray(info.planes)) {
    const selected = select('tool-plane').value
    select('tool-plane').replaceChildren(
      ...info.planes.filter(record).map((p) => {
        const e = document.createElement('option')
        e.value = String(p.index)
        e.textContent = `${p.index}: ${p.name}`
        return e
      }),
    )
    select('tool-plane').value = selected
  }
  if (typeof info.frameCount === 'number') {
    frameCount = info.frameCount
    input('tool-frame').max = String(frameCount - 1)
    const frame = typeof info.frame === 'number' ? info.frame : 0
    input('tool-frame').value = String(frame)
    if (record(info.animation) && typeof info.durationTicks === 'number') {
      const a = info.animation,
        n = a.ticksPerSecondNumerator,
        d = a.ticksPerSecondDenominator
      if (typeof n === 'number' && typeof d === 'number' && n > 0) {
        summary.textContent = `Frame ${frame + 1}/${frameCount} · ${info.durationTicks} ticks at ${n}/${d} ticks/sec · ${(((info.durationTicks * d) / n) * 1000).toFixed(2)} ms · loops ${a.loops === 0 ? 'infinite' : a.loops}`
        if (playing) {
          const last = frame + 1 >= frameCount
          if (last) loop++
          if (last && typeof a.loops === 'number' && a.loops > 0 && loop >= a.loops) stop()
          else
            timer = setTimeout(
              () => {
                input('tool-frame').value = String((frame + 1) % frameCount)
                run('frame')
              },
              Math.max(16, ((info.durationTicks * d) / n) * 1000),
            )
        }
      }
    }
  }
  if (value.bytes) {
    disposeOutput()
    output = { bytes: value.bytes, name: value.name ?? 'output.bin' }
    downloadUrl = URL.createObjectURL(new Blob([value.bytes]))
    button('tool-download').disabled = false
    button('tool-reopen').disabled = !output.name.endsWith('.jxl')
    summary.textContent += ` · ${value.bytes.byteLength.toLocaleString()} output bytes`
  }
  if (value.state === 'done' || value.state === 'output') busy = false
}
const open = async (selected: File) => {
  reset()
  file = selected
  input('tool-frame').value = '0'
  select('tool-plane').replaceChildren(new Option('0', '0'))
  input('tool-sample-x').value = '0'
  input('tool-sample-y').value = '0'
  input('tool-url').value = ''
  status.textContent = `Opening ${selected.name} locally…`
  run(tool === 'progressive' ? 'progressive' : 'open')
}
input('tool-file').onchange = () => {
  const f = input('tool-file').files?.[0]
  if (f) void open(f)
}
for (const el of document.querySelectorAll<HTMLButtonElement>('[data-sample]'))
  el.onclick = () => {
    reset()
    file = undefined
    if (el.dataset.sample?.includes('native16') || el.dataset.sample?.includes('native-extra'))
      input('tool-white').value = '65535'
    else input('tool-white').value = '1'
    const generation = client.generation
    fetching = new AbortController()
    status.textContent = 'Loading public generated sample…'
    void fetch(`/demo-data/${el.dataset.sample}`, { signal: fetching.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Sample HTTP ${r.status}`)
        const b = await r.blob()
        if (generation === client.generation)
          void open(new File([b], el.dataset.sample ?? 'sample.jxl'))
      })
      .catch((e: unknown) => {
        if (generation === client.generation) status.textContent = String(e)
      })
  }
button('tool-run').onclick = () => {
  stop()
  run(tool === 'progressive' ? 'progressive' : 'open')
}
button('tool-cancel').onclick = () => {
  fetching?.abort()
  client.reset()
  busy = false
  stop()
  status.textContent = 'Cancelled. Retry opens a fresh session.'
}
button('tool-native-stage').onclick = () => run('native')
button('tool-viewport').onclick = () => run('viewport')
input('tool-url').oninput = () => {
  reset()
  file = undefined
  status.textContent = 'URL selected. Open it explicitly to allow a network read.'
}
button('tool-export').onclick = () => {
  stop()
  run('export')
}
button('tool-encode').onclick = () => {
  stop()
  run('encode')
}
button('tool-play').onclick = () => {
  if (playing) {
    stop()
    return
  }
  playing = true
  loop = 0
  button('tool-play').textContent = 'Pause'
  run('frame')
}
button('tool-next').onclick = () => {
  stop()
  input('tool-frame').value = String(
    (input('tool-frame').valueAsNumber + 1) % Math.max(1, frameCount),
  )
  run('frame')
}
input('tool-frame').onchange = () => {
  stop()
  run('frame')
}
const frameList = element('tool-frame-list')
function listFrames() {
  frameList.replaceChildren(
    ...files.map((f, i) => {
      const li = document.createElement('li'),
        name = document.createElement('span')
      name.textContent = f.name
      li.append(name)
      for (const [label, delta] of [
        ['Move up', -1],
        ['Move down', 1],
      ] as const) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.disabled = i + delta < 0 || i + delta >= files.length
        b.onclick = () => {
          const other = files[i + delta]
          if (!other) return
          files[i + delta] = f
          files[i] = other
          listFrames()
        }
        li.append(b)
      }
      return li
    }),
  )
}
input('tool-frames').onchange = () => {
  reset()
  files = Array.from(input('tool-frames').files ?? [])
  listFrames()
  status.textContent = `${files.length} creation frames selected. Choose timing then encode.`
}
button('tool-download').onclick = () => {
  if (!output || !downloadUrl) return
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = output.name
  a.click()
}
button('tool-reopen').onclick = () => {
  if (output) void open(new File([output.bytes], output.name))
}
window.addEventListener('pagehide', () => {
  reset()
  file = undefined
  files = []
})
