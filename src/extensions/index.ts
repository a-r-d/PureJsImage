import { invalidInput } from '../errors.ts'
import type {
  AnalysisMigrationDefinition,
  AnalysisMigrationDescriptor,
} from '../analysis/migrations.ts'
import { AnalysisMigrationRegistry, describeAnalysisMigration } from '../analysis/migrations.ts'
import type { OperationJsonObject } from '../operations/descriptor.ts'
import { normalizeValueTypeDescriptor } from '../operations/descriptor.ts'
import type { OperationProvider, OperationProviderDescriptor } from '../operations/provider.ts'
import {
  normalizeOperationProviderDescriptor,
  prepareOperationRuntime,
} from '../operations/provider.ts'
import type { OperationRuntime } from '../operations/provider.ts'
import type {
  OperationDefinition,
  RegistryLimitPolicy,
  ValueTypeDefinition,
} from '../operations/registry.ts'
import {
  createOperationRegistry,
  createValueTypeRegistry,
  type OperationRegistry,
  type ValueTypeRegistry,
} from '../operations/registry.ts'
import type { ScientificReader, ScientificReaderDescriptor } from '../scientific/reader.ts'
import { ScientificReaderRegistry } from '../scientific/reader.ts'

export const pureJsImageExtensionApiVersion = 1

export interface PureJsImageExtensionDescriptor {
  readonly id: string
  readonly version: number
  readonly apiVersion: number
  readonly title?: string
  readonly metadata?: OperationJsonObject
}

export interface PureJsImageExtension {
  readonly descriptor: PureJsImageExtensionDescriptor
  readonly readers?: readonly ScientificReader[]
  readonly valueTypes?: readonly ValueTypeDefinition[]
  readonly operations?: readonly OperationDefinition[]
  readonly providers?: readonly OperationProvider[]
  readonly analysisMigrations?: readonly AnalysisMigrationDefinition[]
}

export interface ExtensionHostOptions {
  readonly extensions: Iterable<PureJsImageExtension>
  readonly readers?: Iterable<ScientificReader>
  readonly valueTypes?: Iterable<ValueTypeDefinition>
  readonly operations?: Iterable<OperationDefinition>
  readonly providers?: Iterable<OperationProvider>
  readonly analysisMigrations?: Iterable<AnalysisMigrationDefinition>
  readonly registryLimits?: Readonly<RegistryLimitPolicy>
}

export interface ExtensionCapabilityManifest {
  readonly extensionApiVersion: 1
  readonly extensions: readonly PureJsImageExtensionDescriptor[]
  readonly readers: readonly ScientificReaderDescriptor[]
  readonly valueTypes: ValueTypeRegistry['capabilitySnapshot']['valueTypes']
  readonly operations: OperationRegistry['capabilitySnapshot']['operations']
  readonly providers: readonly OperationProviderDescriptor[]
  readonly analysisMigrations: readonly AnalysisMigrationDescriptor[]
}

export interface PreparedExtensionHost {
  readonly operations: OperationRegistry
  readonly valueTypes: ValueTypeRegistry
  readonly readers: ScientificReaderRegistry
  readonly runtime: OperationRuntime
  readonly analysisMigrations: AnalysisMigrationRegistry
  readonly manifest: ExtensionCapabilityManifest
  dispose(): Promise<void>
}

export interface ExtensionHost {
  readonly operations: OperationRegistry
  readonly valueTypes: ValueTypeRegistry
  readonly readers: ScientificReaderRegistry
  readonly analysisMigrations: AnalysisMigrationRegistry
  readonly manifest: ExtensionCapabilityManifest
  prepare(signal?: AbortSignal): Promise<PreparedExtensionHost>
}

const extensionIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9-]*)+$/u

const normalizeExtensionJson = (
  value: OperationJsonObject | undefined,
  label: string,
): OperationJsonObject | undefined => {
  if (value === undefined) return undefined
  const wrapper = normalizeValueTypeDescriptor({
    id: `extension.${label}`,
    version: 1,
    title: label,
    capabilities: value,
  })
  return wrapper.capabilities
}

const normalizeExtensionDescriptor = (
  descriptor: PureJsImageExtensionDescriptor,
): PureJsImageExtensionDescriptor => {
  if (!extensionIdPattern.test(descriptor.id) || descriptor.id.startsWith('purejsimage.')) {
    throw invalidInput('Extension id must be a non-core lowercase namespaced identifier')
  }
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 1) {
    throw invalidInput('Extension version must be a positive safe integer')
  }
  if (descriptor.apiVersion !== pureJsImageExtensionApiVersion) {
    throw invalidInput(
      `Extension ${descriptor.id} uses incompatible API version ${descriptor.apiVersion}`,
    )
  }
  if (descriptor.title !== undefined && descriptor.title.trim().length === 0) {
    throw invalidInput('Extension title must be non-empty when provided')
  }
  const metadata = normalizeExtensionJson(descriptor.metadata, 'metadata')
  return Object.freeze({
    id: descriptor.id,
    version: descriptor.version,
    apiVersion: pureJsImageExtensionApiVersion,
    ...(descriptor.title === undefined ? {} : { title: descriptor.title }),
    ...(metadata === undefined ? {} : { metadata }),
  })
}

const providerKey = (descriptor: OperationProviderDescriptor): string =>
  `${descriptor.id}\u0000${descriptor.version}`

const createManifest = (options: {
  readonly extensions: readonly PureJsImageExtensionDescriptor[]
  readonly readers: ScientificReaderRegistry
  readonly valueTypes: ValueTypeRegistry
  readonly operations: OperationRegistry
  readonly providers: readonly OperationProviderDescriptor[]
  readonly analysisMigrations: AnalysisMigrationRegistry
}): ExtensionCapabilityManifest =>
  Object.freeze({
    extensionApiVersion: pureJsImageExtensionApiVersion,
    extensions: options.extensions,
    readers: options.readers.descriptors,
    valueTypes: options.valueTypes.capabilitySnapshot.valueTypes,
    operations: options.operations.capabilitySnapshot.operations,
    providers: Object.freeze([...options.providers]),
    analysisMigrations: Object.freeze(
      options.analysisMigrations.definitions().map(describeAnalysisMigration),
    ),
  })

/**
 * Compose trusted in-process extensions into isolated registries.
 *
 * This executes extension functions in the caller's realm. It is deliberately
 * not a sandbox; untrusted code requires a future Worker or iframe RPC host.
 */
export const createExtensionHost = (options: Readonly<ExtensionHostOptions>): ExtensionHost => {
  const extensions = [...options.extensions]
  const descriptors: PureJsImageExtensionDescriptor[] = []
  const extensionIds = new Set<string>()
  const readers = [...(options.readers ?? [])]
  const valueTypes = [...(options.valueTypes ?? [])]
  const operations = [...(options.operations ?? [])]
  const providers = [...(options.providers ?? [])]
  const analysisMigrations = [...(options.analysisMigrations ?? [])]
  for (const extension of extensions) {
    const descriptor = normalizeExtensionDescriptor(extension.descriptor)
    if (extensionIds.has(descriptor.id)) {
      throw invalidInput(`Extension id already installed: ${descriptor.id}`)
    }
    extensionIds.add(descriptor.id)
    descriptors.push(descriptor)
    for (const reader of extension.readers ?? []) {
      if (reader.descriptor.id.startsWith('purejsimage/')) {
        throw invalidInput(`Extension ${descriptor.id} cannot register a core reader id`)
      }
      readers.push(reader)
    }
    for (const valueType of extension.valueTypes ?? []) {
      if (
        valueType.descriptor.builtIn === true ||
        valueType.descriptor.id.startsWith('purejsimage.')
      ) {
        throw invalidInput(`Extension ${descriptor.id} cannot register a core value type id`)
      }
      valueTypes.push(valueType)
    }
    for (const operation of extension.operations ?? []) {
      if (
        operation.descriptor.builtIn === true ||
        operation.descriptor.id.startsWith('purejsimage.')
      ) {
        throw invalidInput(`Extension ${descriptor.id} cannot register a core operation id`)
      }
      operations.push(operation)
    }
    for (const provider of extension.providers ?? []) {
      if (provider.descriptor.id.startsWith('purejsimage.')) {
        throw invalidInput(`Extension ${descriptor.id} cannot register a core provider id`)
      }
      providers.push(provider)
    }
    for (const migration of extension.analysisMigrations ?? []) {
      if (
        migration.id.startsWith('purejsimage.') ||
        (migration.kind === 'operation' && migration.operationId.startsWith('purejsimage.'))
      ) {
        throw invalidInput(`Extension ${descriptor.id} cannot register a core analysis migration`)
      }
      analysisMigrations.push(migration)
    }
  }

  const providerIds = new Set<string>()
  for (const provider of providers) {
    const descriptor = normalizeOperationProviderDescriptor(provider.descriptor)
    const key = providerKey(descriptor)
    if (providerIds.has(key)) {
      throw invalidInput(
        `Operation provider already registered: ${provider.descriptor.id}@${provider.descriptor.version}`,
      )
    }
    providerIds.add(key)
  }

  // Constructors validate into local values first, so a failure cannot mutate a prior host.
  const readerRegistry = new ScientificReaderRegistry(readers)
  const valueTypeRegistry = createValueTypeRegistry(valueTypes, options.registryLimits)
  const operationRegistry = createOperationRegistry(operations, options.registryLimits)
  const migrationRegistry = new AnalysisMigrationRegistry(analysisMigrations)
  for (const operation of operationRegistry.definitions()) {
    for (const port of [...operation.descriptor.inputs, ...operation.descriptor.outputs]) {
      const found =
        port.valueType.version === undefined
          ? valueTypeRegistry
              .definitions()
              .some((definition) => definition.descriptor.id === port.valueType.id)
          : valueTypeRegistry.get(port.valueType.id, port.valueType.version) !== undefined
      if (!found) {
        throw invalidInput(
          `Operation ${operation.descriptor.id}@${operation.descriptor.version} references unregistered value type ${port.valueType.id}`,
        )
      }
    }
  }
  const extensionDescriptors = Object.freeze(descriptors)
  const providerList = Object.freeze(providers)
  const manifest = createManifest({
    extensions: extensionDescriptors,
    readers: readerRegistry,
    valueTypes: valueTypeRegistry,
    operations: operationRegistry,
    providers: [],
    analysisMigrations: migrationRegistry,
  })

  return Object.freeze({
    operations: operationRegistry,
    valueTypes: valueTypeRegistry,
    readers: readerRegistry,
    analysisMigrations: migrationRegistry,
    manifest,
    async prepare(signal?: AbortSignal): Promise<PreparedExtensionHost> {
      const runtime = await prepareOperationRuntime(providerList, signal)
      const preparedManifest = createManifest({
        extensions: extensionDescriptors,
        readers: readerRegistry,
        valueTypes: valueTypeRegistry,
        operations: operationRegistry,
        providers: runtime.capabilitySnapshot.providers,
        analysisMigrations: migrationRegistry,
      })
      return Object.freeze({
        operations: operationRegistry,
        valueTypes: valueTypeRegistry,
        readers: readerRegistry,
        runtime,
        analysisMigrations: migrationRegistry,
        manifest: preparedManifest,
        dispose: () => runtime.dispose(),
      })
    },
  })
}
