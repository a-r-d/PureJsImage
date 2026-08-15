import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded } from '../../errors.ts'
import type {
  ScientificAxisDescriptor,
  ScientificCalibrationEvidence,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificPlaneReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
} from '../dataset.ts'
import {
  hasTiaEmiSignature,
  indexTiaEmi,
  tiaEmiSignature,
  type TiaEmiLimits,
  type TiaEmiObject,
} from '../formats/tia-emi.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
  ScientificResource,
} from '../reader.ts'
import {
  createScientificDatasetIdentity,
  identifyScientificDataset,
  normalizeScientificRelativeName,
} from '../reader.ts'
import { resourceHasHint } from './shared.ts'
import { createTiaSerReader, type TiaSerReaderOptions } from './tia-ser.ts'

export const tiaEmiReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/tia-emi',
  version: '1.0.0',
  format: 'FEI/Thermo TIA EMI',
  extensions: Object.freeze(['emi']),
  mediaTypes: Object.freeze([
    'application/x-fei-emi',
    'application/x-thermo-tia-emi',
    'application/x-tia-emi',
  ]),
  capabilities: Object.freeze({
    resources: 'companion-set',
    datasets: 'ser-backed-collections',
    axes: 'ranked',
    nativePrecision: true,
    rangeReads: true,
  }),
})

export interface TiaEmiReaderLimits extends TiaEmiLimits {
  readonly maxCompanions: number
  readonly maxDatasets: number
}

export interface TiaEmiReaderOptions {
  readonly limits?: Partial<TiaEmiReaderLimits>
  readonly ser?: TiaSerReaderOptions
}

const defaultLimits: Readonly<TiaEmiReaderLimits> = Object.freeze({
  maxSourceBytes: 16_777_216,
  maxObjects: 256,
  maxXmlBytes: 8_388_608,
  maxXmlDepth: 64,
  maxXmlElements: 100_000,
  maxMetadataFields: 4_096,
  maxMetadataValueCharacters: 65_536,
  maxCompanions: 256,
  maxDatasets: 4_096,
})

const positiveLimit = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (
  input: Readonly<Partial<TiaEmiReaderLimits>> = {},
): Readonly<TiaEmiReaderLimits> =>
  Object.freeze({
    maxSourceBytes: positiveLimit(
      input.maxSourceBytes,
      defaultLimits.maxSourceBytes,
      'TIA EMI maxSourceBytes',
    ),
    maxObjects: positiveLimit(input.maxObjects, defaultLimits.maxObjects, 'TIA EMI maxObjects'),
    maxXmlBytes: positiveLimit(input.maxXmlBytes, defaultLimits.maxXmlBytes, 'TIA EMI maxXmlBytes'),
    maxXmlDepth: positiveLimit(input.maxXmlDepth, defaultLimits.maxXmlDepth, 'TIA EMI maxXmlDepth'),
    maxXmlElements: positiveLimit(
      input.maxXmlElements,
      defaultLimits.maxXmlElements,
      'TIA EMI maxXmlElements',
    ),
    maxMetadataFields: positiveLimit(
      input.maxMetadataFields,
      defaultLimits.maxMetadataFields,
      'TIA EMI maxMetadataFields',
    ),
    maxMetadataValueCharacters: positiveLimit(
      input.maxMetadataValueCharacters,
      defaultLimits.maxMetadataValueCharacters,
      'TIA EMI maxMetadataValueCharacters',
    ),
    maxCompanions: positiveLimit(
      input.maxCompanions,
      defaultLimits.maxCompanions,
      'TIA EMI maxCompanions',
    ),
    maxDatasets: positiveLimit(input.maxDatasets, defaultLimits.maxDatasets, 'TIA EMI maxDatasets'),
  })

const companionStem = (name: string | undefined): string => {
  if (name === undefined) throw invalidInput('TIA EMI companion resolution requires a primary name')
  const normalized = normalizeScientificRelativeName(name)
  const match = normalized.match(/^(.*)\.emi$/iu)
  if (match?.[1] === undefined || match[1].length === 0) {
    throw invalidInput('TIA EMI primary name must end in .emi')
  }
  return match[1]
}

const companionName = (stem: string, index: number): string =>
  normalizeScientificRelativeName(`${stem}_${index}.ser`)

const resolveCompanions = async (
  context: Readonly<ScientificOpenContext>,
  stem: string,
  maxCompanions: number,
): Promise<readonly ScientificResource[]> => {
  if (context.companions === undefined) {
    throw invalidInput('TIA EMI requires a ScientificCompanionResolver for its SER resources')
  }
  const resources: ScientificResource[] = []
  for (let index = 1; index <= maxCompanions + 1; index += 1) {
    throwIfAborted(context.signal)
    const name = companionName(stem, index)
    const resource = await context.companions.resolve({ kind: 'relative-name', name })
    if (resource === undefined) break
    if (index > maxCompanions) {
      throw limitExceeded(`TIA EMI companion count exceeds ${maxCompanions}`)
    }
    resources.push(resource)
  }
  if (resources.length === 0) {
    throw invalidInput(`TIA EMI companion ${companionName(stem, 1)} is missing`)
  }
  return Object.freeze(resources)
}

interface CalibrationMerge {
  readonly appliedAxes: readonly string[]
  readonly preservedConflicts: readonly Readonly<{
    axisId: string
    serUnit: string
    emiInterpretation: string
    reason: string
  }>[]
}

const modeFromObject = (object: TiaEmiObject | undefined): string | undefined => {
  const field = object?.experimentalDescription.find(({ label }) => label.trim() === 'Mode')
  return typeof field?.value === 'string' ? field.value : undefined
}

const calibrationContributors = (
  calibration: ScientificAxisDescriptor['calibration'],
): readonly ScientificCalibrationEvidence[] =>
  calibration === undefined ? [] : 'kind' in calibration ? [calibration] : calibration

const mergeAxisCalibration = (
  axes: readonly ScientificAxisDescriptor[],
  object: TiaEmiObject | undefined,
  resourceId: string,
): Readonly<{ axes: readonly ScientificAxisDescriptor[]; merge: CalibrationMerge }> => {
  const mode = modeFromObject(object)
  const diffraction = mode?.toLowerCase().includes('diffraction') === true
  const appliedAxes: string[] = []
  const preservedConflicts: Array<{
    axisId: string
    serUnit: string
    emiInterpretation: string
    reason: string
  }> = []
  const merged = axes.map((axis): ScientificAxisDescriptor => {
    if (
      !diffraction ||
      (axis.id !== 'x' && axis.id !== 'y') ||
      axis.kind !== 'space' ||
      axis.unit !== 'm' ||
      axis.coordinates.type !== 'linear'
    ) {
      return axis
    }
    if (Math.abs(axis.coordinates.step) < 1) {
      preservedConflicts.push(
        Object.freeze({
          axisId: axis.id,
          serUnit: axis.unit,
          emiInterpretation: '1/m',
          reason: 'SER calibration magnitude is spatial, so the EMI mode hint was not applied.',
        }),
      )
      return axis
    }
    appliedAxes.push(axis.id)
    return Object.freeze({
      ...axis,
      kind: 'reciprocal-space',
      unit: '1/m',
      calibration: Object.freeze([
        ...calibrationContributors(axis.calibration),
        Object.freeze({
          kind: 'sidecar' as const,
          resourceId,
          locator: `tia-emi:ObjectInfo[${object?.index ?? 0}]/ExperimentalDescription/Mode`,
          note: 'Coordinates come from SER; EMI diffraction mode supplies the reciprocal-space interpretation.',
        }),
      ]),
    })
  })
  return Object.freeze({
    axes: Object.freeze(merged),
    merge: Object.freeze({
      appliedAxes: Object.freeze(appliedAxes),
      preservedConflicts: Object.freeze(preservedConflicts),
    }),
  })
}

const objectMetadata = (
  object: TiaEmiObject | undefined,
  merge: CalibrationMerge,
): ScientificMetadataObject =>
  normalizeScientificMetadataObject(
    object === undefined
      ? { metadataAvailable: false }
      : {
          metadataAvailable: true,
          objectIndex: object.index,
          ...(object.uuid === undefined ? {} : { uuid: object.uuid }),
          ...(object.acquireDate === undefined ? {} : { acquireDate: object.acquireDate }),
          ...(object.microscopeConditions === undefined
            ? {}
            : { microscopeConditions: object.microscopeConditions }),
          experimentalDescription: object.experimentalDescription,
          acquireInfo: object.acquireInfo,
          trueImageHeader: object.trueImageHeader,
          calibrationMerge: {
            strategy: 'preserve-ser-axis-facts',
            note: 'SER coordinates remain authoritative; EMI changes only strongly supported axis interpretation and records conflicts.',
            appliedAxes: merge.appliedAxes,
            preservedConflicts: merge.preservedConflicts,
          },
        },
  )

interface DatasetEntry {
  readonly id: string
  readonly name: string
  readonly dataset: ScientificDataset
  readonly identity: Awaited<ReturnType<typeof createScientificDatasetIdentity>>
}

const wrapDataset = (
  dataset: ScientificDataset,
  object: TiaEmiObject | undefined,
  emiResourceId: string,
): ScientificDataset => {
  const merged = mergeAxisCalibration(dataset.descriptor.axes, object, emiResourceId)
  const metadata = objectMetadata(object, merged.merge)
  const descriptor = normalizeScientificDatasetDescriptor({
    ...dataset.descriptor,
    axes: merged.axes,
    metadata: {
      ...(dataset.descriptor.metadata ?? {}),
      'purejsimage:tiaEmi': metadata,
    },
  })
  const readSeries = dataset.readSeries
  return Object.freeze({
    descriptor,
    readPlane(request: Readonly<ScientificPlaneReadRequest>) {
      return dataset.readPlane(request)
    },
    ...(readSeries === undefined
      ? {}
      : {
          readSeries(request: Parameters<typeof readSeries>[0]) {
            return readSeries.call(dataset, request)
          },
        }),
  })
}

export const createTiaEmiReader = (
  options: Readonly<TiaEmiReaderOptions> = {},
): ScientificReader => {
  const limits = resolveLimits(options.limits)
  const serReader = createTiaSerReader(options.ser)
  return Object.freeze({
    descriptor: tiaEmiReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const bytes = await context.primary.source.read(0, tiaEmiSignature.byteLength, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      if (!hasTiaEmiSignature(bytes)) {
        return Object.freeze({ confidence: 0, reason: 'TIA EMI signature is absent' })
      }
      const hinted = resourceHasHint(
        context.primary,
        tiaEmiReaderDescriptor.extensions,
        tiaEmiReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: hinted ? 'TIA EMI header and resource hint match' : 'TIA EMI header matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      const stem = companionStem(context.primary.name)
      const [index, companions] = await Promise.all([
        indexTiaEmi(context.primary.source, limits, {
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        }),
        resolveCompanions(context, stem, limits.maxCompanions),
      ])
      const entries: DatasetEntry[] = []
      for (let companionIndex = 0; companionIndex < companions.length; companionIndex += 1) {
        throwIfAborted(context.signal)
        const companion = companions[companionIndex]
        if (companion === undefined) continue
        const serDocument = await serReader.open({
          primary: companion,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        })
        for (const summary of serDocument.datasets) {
          if (entries.length >= limits.maxDatasets) {
            throw limitExceeded(`TIA EMI dataset count exceeds ${limits.maxDatasets}`)
          }
          const id = `ser-${companionIndex + 1}/${summary.id}`
          const identity = await createScientificDatasetIdentity({
            reader: tiaEmiReaderDescriptor,
            datasetId: id,
            resources: [context.primary, companion],
          })
          const sourceDataset = await serDocument.openDataset(summary.id, {
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          })
          const dataset = identifyScientificDataset(
            wrapDataset(sourceDataset, index.objects[companionIndex], context.primary.id),
            identity,
          )
          const companionLabel = companion.name ?? `SER ${companionIndex + 1}`
          entries.push(
            Object.freeze({
              id,
              name: `${companionLabel}: ${summary.name ?? summary.id}`,
              dataset,
              identity,
            }),
          )
        }
      }
      if (entries.length === 0) throw invalidInput('TIA EMI companions expose no datasets')
      return Object.freeze({
        reader: Object.freeze({
          id: tiaEmiReaderDescriptor.id,
          version: tiaEmiReaderDescriptor.version,
        }),
        format: tiaEmiReaderDescriptor.format,
        metadata: normalizeScientificMetadataObject({
          objectCount: index.objects.length,
          xmlBytes: index.xmlBytes,
          companionCount: companions.length,
          companions: companions.map((resource, companionIndex) => ({
            index: companionIndex + 1,
            resourceId: resource.id,
            ...(resource.name === undefined ? {} : { name: resource.name }),
            metadataObjectIndex:
              index.objects[companionIndex] === undefined ? null : companionIndex,
          })),
          unusedMetadataObjects: Math.max(0, index.objects.length - companions.length),
        }),
        datasets: Object.freeze(
          entries.map((entry) =>
            Object.freeze({
              id: entry.id,
              name: entry.name,
              descriptor: entry.dataset.descriptor,
              identity: entry.identity,
            }),
          ),
        ),
        async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          const entry = entries.find((candidate) => candidate.id === id)
          if (entry === undefined) throw invalidInput(`Unknown TIA EMI dataset ${id}`)
          return entry.dataset
        },
      })
    },
  })
}

export const tiaEmiReader: ScientificReader = createTiaEmiReader()
