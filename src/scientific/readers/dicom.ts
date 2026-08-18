import { throwIfAborted } from '../../abort.ts'
import type { RasterBlock } from '../../raster.ts'
import type { ImageSource } from '../../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import { readDicomEncapsulatedPlane } from '../formats/dicom/encapsulated-pixel.ts'
import type { DicomFileMetaConformance } from '../formats/dicom/file-meta.ts'
import type { DicomLimitOptions, DicomLimits } from '../formats/dicom/limits.ts'
import { defaultDicomLimits, resolveDicomLimits } from '../formats/dicom/limits.ts'
import type {
  DicomStoredValueTransform,
  DicomTechnicalMetadata,
  DicomVoiLutFunction,
  DicomVoiPreset,
} from '../formats/dicom/metadata.ts'
import { createDicomTechnicalMetadata } from '../formats/dicom/metadata.ts'
import { readDicomNativePlane } from '../formats/dicom/native-pixel.ts'
import { parseDicomPart10 } from '../formats/dicom/parser.ts'
import type { DicomPixelDescription } from '../formats/dicom/pixel-description.ts'
import { describeDicomPixels } from '../formats/dicom/pixel-description.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { descriptorWithFormatMetadata, resourceHasHint, singleDatasetDocument } from './shared.ts'

const dicomProbeOffset = 128
const dicomProbeBytes = 4

export const dicomReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/dicom',
  version: '1.0.0',
  format: 'DICOM Part 10 Image',
  extensions: Object.freeze(['dcm', 'dicom']),
  mediaTypes: Object.freeze(['application/dicom']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'single',
    axes: 'labeled',
    selectedFrames: true,
  }),
})

export interface DicomReaderOptions {
  readonly limits?: DicomLimitOptions
  readonly fileMetaConformance?: DicomFileMetaConformance
}

const rowsPerBlock = 32

class DicomScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #pixels: DicomPixelDescription
  readonly #limits: Readonly<DicomLimits>

  constructor(
    source: ImageSource,
    pixels: DicomPixelDescription,
    metadata: DicomTechnicalMetadata,
    resourceId: string,
    limits: Readonly<DicomLimits>,
  ) {
    this.#source = source
    this.#pixels = pixels
    this.#limits = limits
    const spacing = metadata.pixelSpacingMm
    const spatialAxis = (
      id: 'x' | 'y',
      name: string,
      length: number,
      step: number | undefined,
      locator: string,
      formula: string,
    ) =>
      Object.freeze({
        id,
        name,
        kind: 'space' as const,
        length,
        ...(step === undefined || !(step > 0)
          ? { coordinates: Object.freeze({ type: 'index' as const }) }
          : {
              unit: 'mm' as const,
              coordinates: Object.freeze({
                type: 'linear' as const,
                origin: 0,
                step,
              }),
              calibration: Object.freeze({
                kind: 'embedded' as const,
                resourceId,
                locator,
                formula,
              }),
            }),
      })
    const xAxis = spatialAxis(
      'x',
      'X',
      pixels.columns,
      spacing?.column,
      'dicom:(0028,0030)[1]',
      'dicom-column-spacing-mm-v1',
    )
    const yAxis = spatialAxis(
      'y',
      'Y',
      pixels.rows,
      spacing?.row,
      'dicom:(0028,0030)[0]',
      'dicom-row-spacing-mm-v1',
    )
    const frameAxis = Object.freeze({
      id: 'frame',
      name: 'Frame',
      kind: 'index' as const,
      length: pixels.numberOfFrames,
      coordinates: Object.freeze({ type: 'index' as const }),
    })
    const axes =
      pixels.numberOfFrames > 1
        ? Object.freeze([frameAxis, yAxis, xAxis])
        : Object.freeze([yAxis, xAxis])
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes,
      sampleType: pixels.sampleType,
      components: Object.freeze([
        Object.freeze({
          id: 'intensity',
          name: 'Stored intensity',
          kind: 'intensity' as const,
        }),
      ]),
      metadata: normalizeScientificMetadataObject({
        photometricInterpretation: pixels.photometricInterpretation,
        monochromeInverted: metadata.monochromeInverted,
        ...(metadata.storedValueTransform === undefined
          ? {}
          : { storedValueTransform: metadata.storedValueTransform }),
        ...(metadata.storedValueTransformConflict === undefined
          ? {}
          : { storedValueTransformConflict: metadata.storedValueTransformConflict }),
        ...(metadata.voiPresets === undefined ? {} : { voiPresets: metadata.voiPresets }),
        ...(metadata.voiPresetConflict === undefined
          ? {}
          : { voiPresetConflict: metadata.voiPresetConflict }),
      }),
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: {
          kind: 'ordered-axis-pairs',
          pairs: [['x', 'y']],
        },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const frame =
      this.#pixels.numberOfFrames === 1
        ? 0
        : (selected.fixedIndices.find((entry) => entry.axisId === 'frame')?.index ?? 0)
    const plane = {
      frame,
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
      rowsPerBlock,
      maxRegionBytes: this.#limits.maxDecodedFrameBytes,
      maxEncodedFrameBytes: this.#limits.maxEncodedFrameBytes,
      limits: this.#limits,
      ...(selected.signal === undefined ? {} : { signal: selected.signal }),
    }
    if (this.#pixels.encoding === 'native') {
      yield* readDicomNativePlane(this.#source, this.#pixels, plane)
      return
    }
    yield* readDicomEncapsulatedPlane(this.#source, this.#pixels, plane)
  }
}

export const createDicomReader = (options: Readonly<DicomReaderOptions> = {}): ScientificReader => {
  const limits = resolveDicomLimits(options.limits)
  const fileMetaConformance = options.fileMetaConformance
  return Object.freeze({
    descriptor: dicomReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const signature = await context.primary.source.read(dicomProbeOffset, dicomProbeBytes, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      const matches =
        signature.byteLength === dicomProbeBytes &&
        signature[0] === 0x44 &&
        signature[1] === 0x49 &&
        signature[2] === 0x43 &&
        signature[3] === 0x4d
      if (!matches)
        return Object.freeze({ confidence: 0, reason: 'DICOM Part 10 prefix is absent' })
      const hinted = resourceHasHint(
        context.primary,
        dicomReaderDescriptor.extensions,
        dicomReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: hinted
          ? 'DICOM Part 10 prefix and resource hint match'
          : 'DICOM Part 10 prefix matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const parsed = await parseDicomPart10(context.primary.source, {
        limits,
        ...(fileMetaConformance === undefined ? {} : { fileMetaConformance }),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      const pixels = await describeDicomPixels(
        context.primary.source,
        parsed.dataset,
        parsed.pixelData,
        parsed.transferSyntax,
        limits,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const technical = createDicomTechnicalMetadata(parsed.fileMeta, parsed.dataset, pixels)
      const formatMetadata = normalizeScientificMetadataObject(technical)
      const dataset = descriptorWithFormatMetadata(
        new DicomScientificDataset(
          context.primary.source,
          pixels,
          technical,
          context.primary.id,
          limits,
        ),
        'purejsimage:dicom',
        formatMetadata,
      )
      return singleDatasetDocument({
        context,
        reader: dicomReaderDescriptor,
        metadata: formatMetadata,
        dataset,
        datasetId: pixels.numberOfFrames > 1 ? 'frames' : 'image',
        datasetName: pixels.numberOfFrames > 1 ? 'Frames' : 'Image',
      })
    },
  })
}

export const dicomReader: ScientificReader = createDicomReader()

export type {
  DicomLimitOptions,
  DicomLimits,
  DicomStoredValueTransform,
  DicomTechnicalMetadata,
  DicomVoiLutFunction,
  DicomVoiPreset,
}
export type { DicomFileMetaConformance }
export { defaultDicomLimits, resolveDicomLimits }
