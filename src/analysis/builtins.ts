import type { OperationProvider } from '../operations/provider.ts'
import { createOperationProvider } from '../operations/provider.ts'
import type { OperationDefinition, ValueTypeDefinition } from '../operations/registry.ts'
import {
  createOperationRegistry,
  createValueTypeDefinition,
  createValueTypeRegistry,
  type OperationRegistry,
  type ValueTypeRegistry,
} from '../operations/registry.ts'
import type { TileRuntime } from './tile-runtime.ts'
import { analysisResultValueTypeDefinitions } from './result.ts'
import { createRoiValueTypeDefinitions, type RoiLimits } from './roi.ts'
import type { NormalizedScientificDatasetDescriptor } from '../scientific/dataset.ts'
import {
  AnalysisDatasetOperationContext,
  analysisDatasetOperationDefinitions,
  createAnalysisDatasetOperationImplementations,
  scientificDatasetValueTypeId,
} from './builtin-dataset-operations.ts'
import {
  analysisResultOperationDefinitions,
  createAnalysisResultOperationImplementations,
} from './builtin-result-operations.ts'

export const referenceAnalysisProviderId = 'purejsimage.analysis.reference'
export const referenceAnalysisProviderVersion = 1
export const referenceAnalysisBuildFingerprint = 'typescript-reference-v1'

export const scientificDatasetValueTypeDefinition: ValueTypeDefinition = createValueTypeDefinition({
  descriptor: {
    id: scientificDatasetValueTypeId,
    version: 1,
    title: 'Scientific dataset',
    capabilities: Object.freeze({
      schemaVersion: 1,
      storage: 'lazy-raster-blocks-and-native-tiles',
      payloadJsonSafe: false,
      descriptorJsonSafe: true,
    }),
    builtIn: true,
  },
})

export const builtInAnalysisOperationDefinitions: readonly OperationDefinition[] = Object.freeze([
  ...analysisDatasetOperationDefinitions,
  ...analysisResultOperationDefinitions,
])

export const builtInAnalysisOperationDescriptors = Object.freeze(
  builtInAnalysisOperationDefinitions.map((definition) => definition.descriptor),
)

export const createBuiltInAnalysisOperationRegistry = (): OperationRegistry =>
  createOperationRegistry(builtInAnalysisOperationDefinitions)

export const createScientificDatasetValueTypeRegistry = (): ValueTypeRegistry =>
  createValueTypeRegistry([scientificDatasetValueTypeDefinition])

export const createBuiltInAnalysisValueTypeRegistry = (
  descriptor: NormalizedScientificDatasetDescriptor,
  roiLimits: Readonly<RoiLimits> = {},
): ValueTypeRegistry =>
  createValueTypeRegistry([
    scientificDatasetValueTypeDefinition,
    ...analysisResultValueTypeDefinitions,
    ...createRoiValueTypeDefinitions(descriptor, roiLimits),
  ])

export interface ReferenceAnalysisProviderOptions {
  readonly runtime: TileRuntime
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly sessionId?: string
}

export interface BuiltInAnalysisBundleOptions extends ReferenceAnalysisProviderOptions {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly roiLimits?: Readonly<RoiLimits>
}

export interface BuiltInAnalysisBundle {
  readonly operations: OperationRegistry
  readonly valueTypes: ValueTypeRegistry
  readonly providers: readonly OperationProvider[]
}

/** Creates the permanent portable provider explicitly; importing this module registers nothing. */
export const createReferenceAnalysisProvider = (
  options: Readonly<ReferenceAnalysisProviderOptions>,
): OperationProvider => {
  const context = new AnalysisDatasetOperationContext(options)
  return createOperationProvider({
    descriptor: {
      id: referenceAnalysisProviderId,
      version: referenceAnalysisProviderVersion,
      kind: 'reference',
      buildFingerprint: referenceAnalysisBuildFingerprint,
      title: 'PureJsImage strict TypeScript analysis reference provider',
    },
    prepare: async () =>
      Object.freeze([
        ...createAnalysisDatasetOperationImplementations(context),
        ...createAnalysisResultOperationImplementations(context),
      ]),
  })
}

/** Builds an isolated application-owned scientific analysis capability set. */
export const createBuiltInAnalysisBundle = (
  options: Readonly<BuiltInAnalysisBundleOptions>,
): BuiltInAnalysisBundle =>
  Object.freeze({
    operations: createBuiltInAnalysisOperationRegistry(),
    valueTypes: createBuiltInAnalysisValueTypeRegistry(options.descriptor, options.roiLimits),
    providers: Object.freeze([
      createReferenceAnalysisProvider({
        runtime: options.runtime,
        ...(options.tileWidth === undefined ? {} : { tileWidth: options.tileWidth }),
        ...(options.tileHeight === undefined ? {} : { tileHeight: options.tileHeight }),
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      }),
    ]),
  })
