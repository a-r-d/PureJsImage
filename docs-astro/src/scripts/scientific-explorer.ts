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
  const modeGeneric = requiredElement('scientific-mode-generic', HTMLButtonElement)
  const modeSurface = requiredElement('scientific-mode-surface', HTMLButtonElement)
  const modeHyperspectral = requiredElement('scientific-mode-hyperspectral', HTMLButtonElement)
  const modeFits = requiredElement('scientific-mode-fits', HTMLButtonElement)
  const modeMrc = requiredElement('scientific-mode-mrc', HTMLButtonElement)
  const modeCbf = requiredElement('scientific-mode-cbf', HTMLButtonElement)
  const genericSource = requiredElement('scientific-generic-source', HTMLElement)
  const genericFiles = requiredElement('scientific-generic-files', HTMLInputElement)
  const genericPrimary = requiredElement('scientific-generic-primary', HTMLSelectElement)
  const genericReader = requiredElement('scientific-generic-reader', HTMLSelectElement)
  const openGeneric = requiredElement('scientific-open-generic', HTMLButtonElement)
  const surfaceSource = requiredElement('scientific-surface-source', HTMLElement)
  const enviSource = requiredElement('scientific-envi-source', HTMLElement)
  const fitsSource = requiredElement('scientific-fits-source', HTMLElement)
  const mrcSource = requiredElement('scientific-mrc-source', HTMLElement)
  const cbfSource = requiredElement('scientific-cbf-source', HTMLElement)
  const surfaceSample = requiredElement('scientific-sample-surface', HTMLButtonElement)
  const enviSample = requiredElement('scientific-sample-envi', HTMLButtonElement)
  const classificationSample = requiredElement(
    'scientific-sample-classification',
    HTMLButtonElement,
  )
  const fitsSample = requiredElement('scientific-sample-fits', HTMLButtonElement)
  const gsfFile = requiredElement('scientific-gsf-file', HTMLInputElement)
  const enviHeader = requiredElement('scientific-envi-header', HTMLInputElement)
  const enviData = requiredElement('scientific-envi-data', HTMLInputElement)
  const openEnviButton = requiredElement('scientific-open-envi', HTMLButtonElement)
  const fitsFile = requiredElement('scientific-fits-file', HTMLInputElement)
  const mrcFile = requiredElement('scientific-mrc-file', HTMLInputElement)
  const cbfFile = requiredElement('scientific-cbf-file', HTMLInputElement)
  const fitsHduField = requiredElement('scientific-fits-hdu-field', HTMLElement)
  const fitsHdu = requiredElement('scientific-fits-hdu', HTMLSelectElement)
  const datasetField = requiredElement('scientific-dataset-field', HTMLElement)
  const dataset = requiredElement('scientific-dataset', HTMLSelectElement)
  const genericAxisControls = requiredElement('scientific-generic-axis-controls', HTMLElement)
  const genericAxisX = requiredElement('scientific-generic-axis-x', HTMLSelectElement)
  const genericAxisY = requiredElement('scientific-generic-axis-y', HTMLSelectElement)
  const genericFixedAxes = requiredElement('scientific-generic-fixed-axes', HTMLElement)
  const volumeControls = requiredElement('scientific-volume-controls', HTMLElement)
  const sliceAxis = requiredElement('scientific-slice-axis', HTMLSelectElement)
  const projection = requiredElement('scientific-projection', HTMLSelectElement)
  const sliceIndexField = requiredElement('scientific-slice-index-field', HTMLElement)
  const sliceIndex = requiredElement('scientific-slice-index', HTMLInputElement)
  const sliceIndexValue = requiredElement('scientific-slice-index-value', HTMLOutputElement)
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
  const downloadPng = requiredElement('scientific-download-png', HTMLButtonElement)

  const worker = new Worker(new URL('./scientific-worker.ts', import.meta.url), { type: 'module' })
  let mode: ScientificDemoMode = 'surface'
  let opened = false
  let renderSequence = 0
  let renderTimer: number | undefined
  let openedMetadata: ScientificOpenedMetadata | undefined
  const genericFixedInputs = new Map<string, HTMLInputElement>()

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
    channel: numeric(wavelength),
    red: numeric(red),
    green: numeric(green),
    blue: numeric(blue),
    z: 0,
    sliceAxis: sliceAxis.value === 'xz' || sliceAxis.value === 'yz' ? sliceAxis.value : 'xy',
    projection:
      projection.value === 'max' || projection.value === 'min' || projection.value === 'mean'
        ? projection.value
        : 'none',
    sliceIndex: numeric(sliceIndex),
    genericDisplayAxes: [genericAxisX.value, genericAxisY.value],
    genericFixedIndices: Object.freeze(
      [...genericFixedInputs].map(([axisId, input]) =>
        Object.freeze({ axisId, index: numeric(input) }),
      ),
    ),
  })

  const updateSliceControl = (): void => {
    const metadata = openedMetadata
    for (const option of sliceAxis.options) {
      const value = option.value === 'xz' || option.value === 'yz' ? option.value : 'xy'
      option.disabled = metadata !== undefined && !metadata.sliceAxes.includes(value)
    }
    const selected = sliceAxis.value === 'xz' || sliceAxis.value === 'yz' ? sliceAxis.value : 'xy'
    if (metadata !== undefined && !metadata.sliceAxes.includes(selected)) {
      sliceAxis.value = 'xy'
    }
    const count =
      sliceAxis.value === 'xz'
        ? (metadata?.height ?? 1)
        : sliceAxis.value === 'yz'
          ? (metadata?.width ?? 1)
          : (metadata?.sizeZ ?? 1)
    sliceIndex.max = String(Math.max(0, count - 1))
    sliceIndex.value = String(Math.min(numeric(sliceIndex), Math.max(0, count - 1)))
    sliceIndexValue.value = `${numeric(sliceIndex) + 1} of ${count}`
    sliceIndexField.hidden = projection.value !== 'none'
  }

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
    const classification = openedMetadata?.enviFileType === 'ENVI Classification'
    const fits = mode === 'fits'
    const volume =
      fits || mode === 'mrc' || (mode === 'generic' && (openedMetadata?.sizeZ ?? 1) > 1)
    const composite = hyperspectral && !classification && displayMode.value === 'composite'
    displayModeField.hidden = !hyperspectral || classification
    bandControls.hidden = !hyperspectral || classification || composite
    compositeControls.hidden = !composite
    palette.closest('label')?.toggleAttribute('hidden', composite || classification)
    rangeMode.closest('label')?.toggleAttribute('hidden', classification)
    scale.closest('label')?.toggleAttribute('hidden', classification)
    reliefControls.hidden = mode !== 'surface'
    fitsHduField.hidden = !fits
    datasetField.hidden = (openedMetadata?.datasets.length ?? 0) < 2 || fits
    genericAxisControls.hidden = mode !== 'generic'
    volumeControls.hidden = !volume
    updateSliceControl()
    percentileFields.hidden = classification || rangeMode.value !== 'percentile'
    explicitRange.hidden = classification || rangeMode.value !== 'explicit'
  }

  const setMode = (next: ScientificDemoMode): void => {
    mode = next
    opened = false
    openedMetadata = undefined
    modeGeneric.setAttribute('aria-selected', String(next === 'generic'))
    modeSurface.setAttribute('aria-selected', String(next === 'surface'))
    modeHyperspectral.setAttribute('aria-selected', String(next === 'hyperspectral'))
    modeFits.setAttribute('aria-selected', String(next === 'fits'))
    modeMrc.setAttribute('aria-selected', String(next === 'mrc'))
    modeCbf.setAttribute('aria-selected', String(next === 'cbf'))
    genericSource.hidden = next !== 'generic'
    surfaceSource.hidden = next !== 'surface'
    enviSource.hidden = next !== 'hyperspectral'
    fitsSource.hidden = next !== 'fits'
    mrcSource.hidden = next !== 'mrc'
    cbfSource.hidden = next !== 'cbf'
    empty.hidden = false
    canvas.hidden = true
    selection.hidden = true
    updateControlVisibility()
    status.textContent =
      next === 'generic'
        ? 'Choose local files, a primary file, and optional explicit reader.'
        : next === 'surface'
          ? 'Load a GSF surface.'
          : next === 'hyperspectral'
            ? 'Load a paired ENVI header and binary raster.'
            : next === 'fits'
              ? 'Load a FITS image array.'
              : next === 'mrc'
                ? 'Load an MRC2014 or CCP4 volume.'
                : 'Load a CBF or imgCIF detector frame.'
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

  const loadFitsSample = async (): Promise<void> => {
    loading.hidden = false
    const data = await fetchBytes('../demo-data/scientific/synthetic-cube.fits')
    worker.postMessage({ type: 'open-fits', name: 'synthetic-cube.fits', data }, [data])
  }

  const loadClassificationSample = async (): Promise<void> => {
    loading.hidden = false
    const [header, data] = await Promise.all([
      fetchBytes('../demo-data/scientific/synthetic-classification.hdr'),
      fetchBytes('../demo-data/scientific/synthetic-classification.dat'),
    ])
    worker.postMessage(
      {
        type: 'open-envi',
        headerName: 'synthetic-classification.hdr',
        dataName: 'synthetic-classification.dat',
        header,
        data,
      },
      [header, data],
    )
  }

  const openLocalGsf = (file: File): void => {
    worker.postMessage({ type: 'open-gsf', name: file.name, data: file })
  }

  const openLocalEnvi = (headerFile: File, dataFile: File): void => {
    worker.postMessage({
      type: 'open-envi',
      headerName: headerFile.name,
      dataName: dataFile.name,
      header: headerFile,
      data: dataFile,
    })
  }

  const openLocalFits = (file: File): void => {
    worker.postMessage({ type: 'open-fits', name: file.name, data: file })
  }

  const openLocalMrc = (file: File): void => {
    worker.postMessage({ type: 'open-mrc', name: file.name, data: file })
  }

  const openLocalCbf = (file: File): void => {
    worker.postMessage({ type: 'open-cbf', name: file.name, data: file })
  }

  const spectralOutput = (channel: number): string => {
    const center = openedMetadata?.channelCenters?.[channel]
    return `Band ${channel + 1} of ${openedMetadata?.bands ?? 1}${center == null ? '' : ` · ${center} ${openedMetadata?.wavelengthUnit ?? ''}`}`.trim()
  }

  const updateSpectralOutputs = (): void => {
    wavelengthValue.value = spectralOutput(numeric(wavelength))
    redValue.value = spectralOutput(numeric(red))
    greenValue.value = spectralOutput(numeric(green))
    blueValue.value = spectralOutput(numeric(blue))
  }

  const setSpectralSliders = (metadata: ScientificOpenedMetadata): void => {
    for (const control of [wavelength, red, green, blue]) {
      control.min = '0'
      control.max = String(Math.max(0, metadata.bands - 1))
      control.step = '1'
    }
    wavelength.value = String(Math.floor(metadata.bands / 2))
    red.value = String(Math.min(metadata.bands - 1, Math.floor(metadata.bands * 0.65)))
    green.value = String(Math.min(metadata.bands - 1, Math.floor(metadata.bands * 0.4)))
    blue.value = String(Math.min(metadata.bands - 1, Math.floor(metadata.bands * 0.15)))
    updateSpectralOutputs()
  }

  const replaceAxisOptions = (
    select: HTMLSelectElement,
    ids: readonly string[],
    metadata: ScientificOpenedMetadata,
  ): void => {
    const previous = select.value
    select.replaceChildren(
      ...ids.map((id) => {
        const axis = metadata.axes.find((entry) => entry.id === id)
        const option = document.createElement('option')
        option.value = id
        option.textContent = `${axis?.name ?? id} · ${axis?.kind ?? 'other'} · ${axis?.length ?? 0}`
        option.selected = id === previous
        return option
      }),
    )
  }

  const rebuildGenericFixedAxes = (metadata: ScientificOpenedMetadata): void => {
    genericFixedInputs.clear()
    const controls = metadata.axes
      .filter(({ id }) => id !== genericAxisX.value && id !== genericAxisY.value)
      .map((axis) => {
        const label = document.createElement('label')
        label.textContent = `${axis.name} index (0 to ${axis.length - 1})`
        const input = document.createElement('input')
        input.type = 'number'
        input.min = '0'
        input.max = String(axis.length - 1)
        input.step = '1'
        input.value = '0'
        input.addEventListener('input', scheduleRender)
        genericFixedInputs.set(axis.id, input)
        label.append(input)
        return label
      })
    genericFixedAxes.replaceChildren(...controls)
  }

  const rebuildGenericAxisY = (metadata: ScientificOpenedMetadata): void => {
    const vertical = metadata.displayAxisPairs
      .filter(([horizontal]) => horizontal === genericAxisX.value)
      .map(([, axisId]) => axisId)
    replaceAxisOptions(genericAxisY, vertical, metadata)
    rebuildGenericFixedAxes(metadata)
  }

  const setGenericAxes = (metadata: ScientificOpenedMetadata): void => {
    const horizontal = [...new Set(metadata.displayAxisPairs.map(([axisId]) => axisId))]
    replaceAxisOptions(genericAxisX, horizontal, metadata)
    rebuildGenericAxisY(metadata)
  }

  const showOpened = (metadata: ScientificOpenedMetadata): void => {
    opened = true
    mode = metadata.mode
    openedMetadata = metadata
    if (metadata.mode === 'generic') setGenericAxes(metadata)
    dataset.replaceChildren(
      ...metadata.datasets.map((entry) => {
        const option = document.createElement('option')
        option.value = entry.id
        option.textContent = entry.name
        option.selected = entry.id === metadata.datasetId
        return option
      }),
    )
    updateControlVisibility()
    metricName.textContent = metadata.title ? `${metadata.title} · ${metadata.name}` : metadata.name
    metricDimensions.textContent = `${metadata.width} × ${metadata.height}${(metadata.mode === 'fits' || metadata.mode === 'mrc') && (metadata.sizeZ ?? 1) > 1 ? ` × ${metadata.sizeZ}` : metadata.bands > 1 ? ` × ${metadata.bands}` : ''}`
    metricSamples.textContent = `${metadata.sampleType}${metadata.valueUnit ? ` · ${metadata.valueUnit}` : ''}`
    metricNativeRange.textContent =
      metadata.dataMin === undefined || metadata.dataMax === undefined
        ? 'Not measured'
        : `${formatNumber(metadata.dataMin)} – ${formatNumber(metadata.dataMax)}`
    metricBytes.textContent = formatBytes(metadata.sourceBytes)
    rangeMin.value = String(metadata.dataMin ?? 0)
    rangeMax.value = String(metadata.dataMax ?? 1)
    if (metadata.mode === 'surface') {
      metricPhysical.textContent =
        metadata.physicalWidth === undefined || metadata.physicalHeight === undefined
          ? 'Not declared'
          : `${physicalValue(metadata.physicalWidth, metadata.physicalUnit)} × ${physicalValue(metadata.physicalHeight, metadata.physicalUnit)}`
      metricDetail.textContent =
        metadata.pixelSizeX === undefined || metadata.pixelSizeY === undefined
          ? 'Not declared'
          : `${physicalValue(metadata.pixelSizeX, metadata.physicalUnit)} × ${physicalValue(metadata.pixelSizeY, metadata.physicalUnit)} / pixel`
    } else if (metadata.mode === 'hyperspectral') {
      if (metadata.enviFileType === 'ENVI Classification') {
        metricPhysical.textContent = 'Categorical class map'
        metricDetail.textContent = `${metadata.classificationClasses ?? 0} declared classes`
      } else {
        metricPhysical.textContent =
          metadata.wavelengthMin === undefined || metadata.wavelengthMax === undefined
            ? 'No spectral axis'
            : `${metadata.wavelengthMin}–${metadata.wavelengthMax} ${metadata.wavelengthUnit ?? ''}`.trim()
        metricDetail.textContent = `${metadata.bands} spectral bands`
        setSpectralSliders(metadata)
      }
    } else if (metadata.mode === 'fits') {
      metricPhysical.textContent = `HDU ${metadata.fitsHdu ?? 0} · ${metadata.fitsPrimary ? 'Primary' : 'IMAGE extension'}`
      metricDetail.textContent = `BITPIX ${metadata.bitpix} · stored ${metadata.storedSampleType} · BSCALE ${metadata.bscale} · BZERO ${metadata.bzero}${metadata.blank === undefined ? '' : ` · BLANK ${metadata.blank}`}`
      fitsHdu.replaceChildren(
        ...(metadata.fitsHdus ?? []).map((hdu) => {
          const option = document.createElement('option')
          option.value = String(hdu.index)
          option.textContent = hdu.label
          option.disabled = !hdu.canOpenRaster
          option.selected = hdu.index === metadata.fitsHdu
          return option
        }),
      )
      sliceIndex.value = '0'
      updateSliceControl()
    } else if (metadata.mode === 'mrc') {
      metricPhysical.textContent =
        metadata.pixelSizeX === undefined || metadata.pixelSizeY === undefined
          ? 'Voxel spacing not declared'
          : `${physicalValue(metadata.pixelSizeX, metadata.physicalUnit)} × ${physicalValue(metadata.pixelSizeY, metadata.physicalUnit)}`
      metricDetail.textContent = `MRC MODE ${metadata.mrcMode} · ${metadata.byteOrder}`
      sliceIndex.value = '0'
      updateSliceControl()
    } else if (metadata.mode === 'cbf') {
      metricPhysical.textContent = metadata.detectorName ?? 'Detector not declared'
      metricDetail.textContent =
        [
          metadata.exposureTimeSeconds === undefined
            ? undefined
            : `${formatNumber(metadata.exposureTimeSeconds)} s exposure`,
          metadata.wavelengthAngstroms === undefined
            ? undefined
            : `${formatNumber(metadata.wavelengthAngstroms)} Å wavelength`,
        ]
          .filter((value): value is string => value !== undefined)
          .join(' · ') || 'Native detector counts'
    } else {
      metricPhysical.textContent = `${metadata.readerFormat} · ${metadata.readerId}`
      metricDetail.textContent = metadata.axes
        .map(
          (entry) =>
            `${entry.name}: ${entry.length}${entry.unit === undefined ? '' : ` ${entry.unit}`}`,
        )
        .join(' · ')
    }
    status.textContent = 'Metadata parsed. Rendering display pixels…'
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
    if (response.type === 'png') {
      const url = URL.createObjectURL(new Blob([response.data], { type: 'image/png' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'purejsimage-scientific-display.png'
      link.click()
      URL.revokeObjectURL(url)
      status.textContent = 'Downloaded the current display rendering as PNG.'
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
    if (response.nativeRangeLabel !== undefined)
      metricNativeRange.textContent = response.nativeRangeLabel
    metricBytesLabel.textContent = response.sourceBytesLabel
    metricBytes.textContent = formatBytes(response.sourceBytesRead)
    metricTime.textContent = `${response.renderMilliseconds.toFixed(1)} ms`
    selection.hidden = response.selectionLabel === undefined
    selection.textContent = response.selectionLabel ?? ''
  }

  modeGeneric.addEventListener('click', () => setMode('generic'))
  modeSurface.addEventListener('click', () => setMode('surface'))
  modeHyperspectral.addEventListener('click', () => setMode('hyperspectral'))
  modeFits.addEventListener('click', () => setMode('fits'))
  modeMrc.addEventListener('click', () => setMode('mrc'))
  modeCbf.addEventListener('click', () => setMode('cbf'))
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
  classificationSample.addEventListener(
    'click',
    () =>
      void loadClassificationSample().catch((cause: unknown) => {
        status.textContent =
          cause instanceof Error ? cause.message : 'Could not load ENVI classification sample'
      }),
  )
  fitsSample.addEventListener(
    'click',
    () =>
      void loadFitsSample().catch((cause: unknown) => {
        status.textContent = cause instanceof Error ? cause.message : 'Could not load FITS sample'
      }),
  )
  gsfFile.addEventListener('change', () => {
    const file = gsfFile.files?.[0]
    if (file) openLocalGsf(file)
  })
  const updateEnviButton = (): void => {
    openEnviButton.disabled = !enviHeader.files?.[0] || !enviData.files?.[0]
  }
  enviHeader.addEventListener('change', updateEnviButton)
  enviData.addEventListener('change', updateEnviButton)
  openEnviButton.addEventListener('click', () => {
    const header = enviHeader.files?.[0]
    const data = enviData.files?.[0]
    if (header && data) openLocalEnvi(header, data)
  })
  fitsFile.addEventListener('change', () => {
    const file = fitsFile.files?.[0]
    if (file) openLocalFits(file)
  })
  mrcFile.addEventListener('change', () => {
    const file = mrcFile.files?.[0]
    if (file) openLocalMrc(file)
  })
  cbfFile.addEventListener('change', () => {
    const file = cbfFile.files?.[0]
    if (file) openLocalCbf(file)
  })
  const updateGenericFiles = (): void => {
    const files = Array.from(genericFiles.files ?? [])
    genericPrimary.replaceChildren(
      ...files.map((file, index) => {
        const option = document.createElement('option')
        option.value = String(index)
        option.textContent = file.name
        return option
      }),
    )
    genericPrimary.disabled = files.length === 0
    openGeneric.disabled = files.length === 0
  }
  genericFiles.addEventListener('change', updateGenericFiles)
  openGeneric.addEventListener('click', () => {
    const files = Array.from(genericFiles.files ?? [])
    if (files.length === 0) return
    worker.postMessage({
      type: 'open-generic',
      primaryIndex: Number(genericPrimary.value),
      files,
      ...(genericReader.value.length === 0 ? {} : { readerId: genericReader.value }),
    })
  })
  dataset.addEventListener('change', () => {
    worker.postMessage({ type: 'select-dataset', id: dataset.value })
  })
  genericAxisX.addEventListener('change', () => {
    if (openedMetadata?.mode !== 'generic') return
    rebuildGenericAxisY(openedMetadata)
    scheduleRender()
  })
  genericAxisY.addEventListener('change', () => {
    if (openedMetadata?.mode !== 'generic') return
    rebuildGenericFixedAxes(openedMetadata)
    scheduleRender()
  })
  fitsHdu.addEventListener('change', () => {
    worker.postMessage({ type: 'select-fits-hdu', index: Number(fitsHdu.value) })
  })
  downloadPng.addEventListener('click', () => worker.postMessage({ type: 'download-png' }))

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
    sliceAxis,
    projection,
    sliceIndex,
  ]) {
    control.addEventListener('input', () => {
      updateSpectralOutputs()
      updateSliceControl()
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
    const fits = files.find((file) => /\.(?:fits?|fts)$/i.test(file.name))
    const mrc = files.find((file) => /\.(?:mrc|map|ccp4)$/i.test(file.name))
    const cbf = files.find((file) => /\.(?:cbf|img)$/i.test(file.name))
    if (gsf) {
      setMode('surface')
      openLocalGsf(gsf)
      return
    }
    if (fits) {
      setMode('fits')
      openLocalFits(fits)
      return
    }
    if (mrc) {
      setMode('mrc')
      openLocalMrc(mrc)
      return
    }
    if (cbf) {
      setMode('cbf')
      openLocalCbf(cbf)
      return
    }
    const data = files.find((file) => file !== header)
    if (header && data) {
      setMode('hyperspectral')
      openLocalEnvi(header, data)
      return
    }
    if (files.length > 0) {
      setMode('generic')
      worker.postMessage({ type: 'open-generic', primaryIndex: 0, files })
      return
    }
    status.textContent = 'Drop at least one local scientific file.'
  })

  setMode('surface')
  void loadSurfaceSample()
}
