import type {
  ScientificDemoMode,
  ScientificDemoRenderSettings,
  ScientificOpenedMetadata,
  ScientificWorkerResponse,
} from './scientific-types.ts'

type ElementConstructor<ElementType extends Element> = { new (): ElementType }

const requiredElement = <ElementType extends Element>(
  id: string,
  Constructor: ElementConstructor<ElementType>,
): ElementType => {
  const candidate = document.getElementById(id)
  if (!(candidate instanceof Constructor))
    throw new Error(`Scientific explorer element #${id} is missing`)
  return candidate
}

export const startScientificExplorer = (): void => {
  const modeSurface = requiredElement('scientific-mode-surface', HTMLButtonElement)
  const modeHyperspectral = requiredElement('scientific-mode-hyperspectral', HTMLButtonElement)
  const surfaceSource = requiredElement('scientific-surface-source', HTMLElement)
  const enviSource = requiredElement('scientific-envi-source', HTMLElement)
  const surfaceSample = requiredElement('scientific-sample-surface', HTMLButtonElement)
  const enviSample = requiredElement('scientific-sample-envi', HTMLButtonElement)
  const gsfFile = requiredElement('scientific-gsf-file', HTMLInputElement)
  const enviHeader = requiredElement('scientific-envi-header', HTMLInputElement)
  const enviData = requiredElement('scientific-envi-data', HTMLInputElement)
  const openEnviButton = requiredElement('scientific-open-envi', HTMLButtonElement)
  const dropZone = requiredElement('scientific-drop-zone', HTMLElement)
  const displayModeField = requiredElement('scientific-display-mode-field', HTMLElement)
  const displayMode = requiredElement('scientific-display-mode', HTMLSelectElement)
  const palette = requiredElement('scientific-palette', HTMLSelectElement)
  const rangeMode = requiredElement('scientific-range-mode', HTMLSelectElement)
  const percentileFields = requiredElement('scientific-percentiles', HTMLElement)
  const percentileLow = requiredElement('scientific-percentile-low', HTMLInputElement)
  const percentileHigh = requiredElement('scientific-percentile-high', HTMLInputElement)
  const explicitRange = requiredElement('scientific-explicit-range', HTMLElement)
  const rangeMin = requiredElement('scientific-range-min', HTMLInputElement)
  const rangeMax = requiredElement('scientific-range-max', HTMLInputElement)
  const scale = requiredElement('scientific-scale', HTMLSelectElement)
  const bandControls = requiredElement('scientific-band-controls', HTMLElement)
  const compositeControls = requiredElement('scientific-composite-controls', HTMLElement)
  const wavelength = requiredElement('scientific-wavelength', HTMLInputElement)
  const wavelengthValue = requiredElement('scientific-wavelength-value', HTMLOutputElement)
  const red = requiredElement('scientific-red', HTMLInputElement)
  const redValue = requiredElement('scientific-red-value', HTMLOutputElement)
  const green = requiredElement('scientific-green', HTMLInputElement)
  const greenValue = requiredElement('scientific-green-value', HTMLOutputElement)
  const blue = requiredElement('scientific-blue', HTMLInputElement)
  const blueValue = requiredElement('scientific-blue-value', HTMLOutputElement)
  const reliefControls = requiredElement('scientific-relief-controls', HTMLElement)
  const relief = requiredElement('scientific-relief', HTMLInputElement)
  const azimuth = requiredElement('scientific-azimuth', HTMLInputElement)
  const azimuthValue = requiredElement('scientific-azimuth-value', HTMLOutputElement)
  const elevation = requiredElement('scientific-elevation', HTMLInputElement)
  const elevationValue = requiredElement('scientific-elevation-value', HTMLOutputElement)
  const strength = requiredElement('scientific-strength', HTMLInputElement)
  const strengthValue = requiredElement('scientific-strength-value', HTMLOutputElement)
  const canvas = requiredElement('scientific-canvas', HTMLCanvasElement)
  const empty = requiredElement('scientific-empty', HTMLElement)
  const loading = requiredElement('scientific-loading', HTMLElement)
  const status = requiredElement('scientific-status', HTMLElement)
  const selection = requiredElement('scientific-selection', HTMLElement)
  const metricName = requiredElement('scientific-metric-name', HTMLElement)
  const metricDimensions = requiredElement('scientific-metric-dimensions', HTMLElement)
  const metricSamples = requiredElement('scientific-metric-samples', HTMLElement)
  const metricPhysical = requiredElement('scientific-metric-physical', HTMLElement)
  const metricDetail = requiredElement('scientific-metric-detail', HTMLElement)
  const metricNativeRange = requiredElement('scientific-metric-native-range', HTMLElement)
  const metricRange = requiredElement('scientific-metric-range', HTMLElement)
  const metricBytesLabel = requiredElement('scientific-metric-bytes-label', HTMLElement)
  const metricBytes = requiredElement('scientific-metric-bytes', HTMLElement)
  const metricTime = requiredElement('scientific-metric-time', HTMLElement)

  const worker = new Worker(new URL('./scientific-worker.ts', import.meta.url), { type: 'module' })
  let mode: ScientificDemoMode = 'surface'
  let opened = false
  let renderSequence = 0
  let renderTimer: number | undefined

  const formatBytes = (bytes: number): string =>
    bytes < 1_024
      ? `${bytes} B`
      : bytes < 1_048_576
        ? `${(bytes / 1_024).toFixed(1)} KiB`
        : `${(bytes / 1_048_576).toFixed(2)} MiB`

  const formatNumber = (value: number): string => {
    const absolute = Math.abs(value)
    return absolute !== 0 && (absolute < 0.001 || absolute >= 100_000)
      ? value.toExponential(5)
      : value.toLocaleString(undefined, { maximumSignificantDigits: 7 })
  }

  const physicalValue = (value: number, unit: string | undefined): string => {
    if (unit === 'm') return `${formatNumber(value * 1e6)} µm`
    return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
  }

  const numeric = (input: HTMLInputElement): number => Number(input.value)

  const settings = (): ScientificDemoRenderSettings => ({
    displayMode: displayMode.value === 'composite' ? 'composite' : 'band',
    palette:
      palette.value === 'grayscale' ||
      palette.value === 'magma' ||
      palette.value === 'inferno' ||
      palette.value === 'plasma'
        ? palette.value
        : 'viridis',
    rangeMode:
      rangeMode.value === 'dataset' || rangeMode.value === 'explicit'
        ? rangeMode.value
        : 'percentile',
    rangeMin: numeric(rangeMin),
    rangeMax: numeric(rangeMax),
    percentileLow: numeric(percentileLow),
    percentileHigh: numeric(percentileHigh),
    scale:
      scale.value === 'log' || scale.value === 'sqrt' || scale.value === 'asinh'
        ? scale.value
        : 'linear',
    relief: relief.checked,
    reliefAzimuth: numeric(azimuth),
    reliefElevation: numeric(elevation),
    reliefStrength: numeric(strength),
    wavelength: numeric(wavelength),
    red: numeric(red),
    green: numeric(green),
    blue: numeric(blue),
  })

  const render = (): void => {
    if (!opened) return
    renderSequence += 1
    loading.hidden = false
    status.textContent = 'Rendering native samples in the worker…'
    worker.postMessage({ type: 'render', sequence: renderSequence, settings: settings() })
  }

  const scheduleRender = (): void => {
    if (renderTimer !== undefined) window.clearTimeout(renderTimer)
    renderTimer = window.setTimeout(render, 40)
  }

  const updateControlVisibility = (): void => {
    const hyperspectral = mode === 'hyperspectral'
    const composite = hyperspectral && displayMode.value === 'composite'
    displayModeField.hidden = !hyperspectral
    bandControls.hidden = !hyperspectral || composite
    compositeControls.hidden = !composite
    palette.closest('label')?.toggleAttribute('hidden', composite)
    reliefControls.hidden = hyperspectral
    percentileFields.hidden = rangeMode.value !== 'percentile'
    explicitRange.hidden = rangeMode.value !== 'explicit'
  }

  const setMode = (next: ScientificDemoMode): void => {
    mode = next
    opened = false
    modeSurface.setAttribute('aria-selected', String(next === 'surface'))
    modeHyperspectral.setAttribute('aria-selected', String(next === 'hyperspectral'))
    surfaceSource.hidden = next !== 'surface'
    enviSource.hidden = next !== 'hyperspectral'
    empty.hidden = false
    canvas.hidden = true
    selection.hidden = true
    updateControlVisibility()
    status.textContent =
      next === 'surface' ? 'Load a GSF surface.' : 'Load a paired ENVI header and binary raster.'
  }

  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Demo data request failed with HTTP ${response.status}`)
    return response.arrayBuffer()
  }

  const loadSurfaceSample = async (): Promise<void> => {
    loading.hidden = false
    const data = await fetchBytes('../demo-data/scientific/synthetic-afm.gsf')
    worker.postMessage({ type: 'open-gsf', name: 'synthetic-afm.gsf', data }, [data])
  }

  const loadEnviSample = async (): Promise<void> => {
    loading.hidden = false
    const [header, data] = await Promise.all([
      fetchBytes('../demo-data/scientific/synthetic-hyperspectral.hdr'),
      fetchBytes('../demo-data/scientific/synthetic-hyperspectral.bin'),
    ])
    worker.postMessage(
      {
        type: 'open-envi',
        headerName: 'synthetic-hyperspectral.hdr',
        dataName: 'synthetic-hyperspectral.bin',
        header,
        data,
      },
      [header, data],
    )
  }

  const openLocalGsf = async (file: File): Promise<void> => {
    const data = await file.arrayBuffer()
    worker.postMessage({ type: 'open-gsf', name: file.name, data }, [data])
  }

  const openLocalEnvi = async (headerFile: File, dataFile: File): Promise<void> => {
    const [header, data] = await Promise.all([headerFile.arrayBuffer(), dataFile.arrayBuffer()])
    worker.postMessage(
      { type: 'open-envi', headerName: headerFile.name, dataName: dataFile.name, header, data },
      [header, data],
    )
  }

  const setSpectralSliders = (metadata: ScientificOpenedMetadata): void => {
    if (metadata.wavelengthMin === undefined || metadata.wavelengthMax === undefined) return
    const minimum = metadata.wavelengthMin
    const maximum = metadata.wavelengthMax
    const step = metadata.bands > 1 ? (maximum - minimum) / (metadata.bands - 1) : 1
    const controls = [wavelength, red, green, blue]
    for (const control of controls) {
      control.min = String(minimum)
      control.max = String(maximum)
      control.step = String(step)
    }
    wavelength.value = String(minimum + step * Math.floor(metadata.bands / 2))
    red.value = String(minimum + step * Math.floor(metadata.bands * 0.65))
    green.value = String(minimum + step * Math.floor(metadata.bands * 0.4))
    blue.value = String(minimum + step * Math.floor(metadata.bands * 0.15))
    wavelengthValue.value = wavelength.value
    redValue.value = red.value
    greenValue.value = green.value
    blueValue.value = blue.value
  }

  const showOpened = (metadata: ScientificOpenedMetadata): void => {
    opened = true
    mode = metadata.mode
    updateControlVisibility()
    metricName.textContent = metadata.title ? `${metadata.title} · ${metadata.name}` : metadata.name
    metricDimensions.textContent = `${metadata.width} × ${metadata.height}${metadata.bands > 1 ? ` × ${metadata.bands}` : ''}`
    metricSamples.textContent = `${metadata.sampleType}${metadata.valueUnit ? ` · ${metadata.valueUnit}` : ''}`
    metricNativeRange.textContent = `${formatNumber(metadata.dataMin)} – ${formatNumber(metadata.dataMax)}`
    metricBytes.textContent = formatBytes(metadata.sourceBytes)
    rangeMin.value = String(metadata.dataMin)
    rangeMax.value = String(metadata.dataMax)
    if (metadata.mode === 'surface') {
      metricPhysical.textContent =
        metadata.physicalWidth === undefined || metadata.physicalHeight === undefined
          ? 'Not declared'
          : `${physicalValue(metadata.physicalWidth, metadata.physicalUnit)} × ${physicalValue(metadata.physicalHeight, metadata.physicalUnit)}`
      metricDetail.textContent =
        metadata.pixelSizeX === undefined || metadata.pixelSizeY === undefined
          ? 'Not declared'
          : `${physicalValue(metadata.pixelSizeX, metadata.physicalUnit)} × ${physicalValue(metadata.pixelSizeY, metadata.physicalUnit)} / pixel`
    } else {
      metricPhysical.textContent =
        metadata.wavelengthMin === undefined || metadata.wavelengthMax === undefined
          ? 'No spectral axis'
          : `${metadata.wavelengthMin}–${metadata.wavelengthMax} ${metadata.wavelengthUnit ?? ''}`.trim()
      metricDetail.textContent = `${metadata.bands} spectral bands`
      setSpectralSliders(metadata)
    }
    status.textContent = 'Native metadata parsed. Rendering explicit display pixels…'
    render()
  }

  worker.onmessage = (event: MessageEvent<ScientificWorkerResponse>): void => {
    const response = event.data
    if (response.type === 'opening') {
      loading.hidden = false
      status.textContent = response.message
      return
    }
    if (response.type === 'opened') {
      showOpened(response.metadata)
      return
    }
    if (response.type === 'error') {
      loading.hidden = true
      status.textContent = response.message
      status.dataset.error = 'true'
      return
    }
    if (response.sequence !== renderSequence) return
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Scientific explorer canvas context is unavailable')
    canvas.width = response.width
    canvas.height = response.height
    context.putImageData(new ImageData(response.pixels, response.width, response.height), 0, 0)
    canvas.hidden = false
    empty.hidden = true
    loading.hidden = true
    status.dataset.error = 'false'
    status.textContent = 'Rendered locally from native numeric samples.'
    metricRange.textContent = response.rangeLabel
    metricBytesLabel.textContent = response.sourceBytesLabel
    metricBytes.textContent = formatBytes(response.sourceBytesRead)
    metricTime.textContent = `${response.renderMilliseconds.toFixed(1)} ms`
    selection.hidden = response.selectionLabel === undefined
    selection.textContent = response.selectionLabel ?? ''
  }

  modeSurface.addEventListener('click', () => setMode('surface'))
  modeHyperspectral.addEventListener('click', () => setMode('hyperspectral'))
  surfaceSample.addEventListener(
    'click',
    () =>
      void loadSurfaceSample().catch((cause: unknown) => {
        status.textContent = cause instanceof Error ? cause.message : 'Could not load GSF sample'
      }),
  )
  enviSample.addEventListener(
    'click',
    () =>
      void loadEnviSample().catch((cause: unknown) => {
        status.textContent = cause instanceof Error ? cause.message : 'Could not load ENVI sample'
      }),
  )
  gsfFile.addEventListener('change', () => {
    const file = gsfFile.files?.[0]
    if (file) void openLocalGsf(file)
  })
  const updateEnviButton = (): void => {
    openEnviButton.disabled = !enviHeader.files?.[0] || !enviData.files?.[0]
  }
  enviHeader.addEventListener('change', updateEnviButton)
  enviData.addEventListener('change', updateEnviButton)
  openEnviButton.addEventListener('click', () => {
    const header = enviHeader.files?.[0]
    const data = enviData.files?.[0]
    if (header && data) void openLocalEnvi(header, data)
  })

  for (const control of [
    displayMode,
    palette,
    rangeMode,
    percentileLow,
    percentileHigh,
    rangeMin,
    rangeMax,
    scale,
    relief,
    azimuth,
    elevation,
    strength,
    wavelength,
    red,
    green,
    blue,
  ]) {
    control.addEventListener('input', () => {
      wavelengthValue.value = wavelength.value
      redValue.value = red.value
      greenValue.value = green.value
      blueValue.value = blue.value
      azimuthValue.value = `${azimuth.value}°`
      elevationValue.value = `${elevation.value}°`
      strengthValue.value = strength.value
      updateControlVisibility()
      scheduleRender()
    })
  }

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault()
    dropZone.classList.add('dragging')
  })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'))
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault()
    dropZone.classList.remove('dragging')
    const files = Array.from(event.dataTransfer?.files ?? [])
    const header = files.find((file) => /\.hdr(?:\.txt)?$/i.test(file.name))
    const gsf = files.find((file) => file.name.toLowerCase().endsWith('.gsf'))
    if (gsf) {
      setMode('surface')
      void openLocalGsf(gsf)
      return
    }
    const data = files.find((file) => file !== header)
    if (header && data) {
      setMode('hyperspectral')
      void openLocalEnvi(header, data)
      return
    }
    status.textContent =
      'Drop one .gsf file or an ENVI .hdr/.hdr.txt file together with its binary raster.'
  })

  setMode('surface')
  void loadSurfaceSample()
}
