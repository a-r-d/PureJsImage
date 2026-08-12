import type {
  OperationJsonObject,
  OperationJsonValue,
  OperationValidationResult,
} from '../operations/descriptor.ts'
import { normalizeOperationJsonObject } from '../operations/descriptor.ts'
import { invalidInput } from '../errors.ts'
import type { OperationProvider, OperationProviderPolicy } from '../operations/provider.ts'
import { normalizeOperationProviderDescriptor } from '../operations/provider.ts'
import type { OperationRegistry, ValueTypeRegistry } from '../operations/registry.ts'
import type { SourceIdentity } from '../source-identity.ts'
import type { AnalysisExecutionTask, AnalysisLibraryBuild } from './executor.ts'
import { executeGraph as startExecution } from './executor.ts'
import type { AnalysisGraph, AnalysisGraphValidation, AnalysisLimits } from './graph.ts'
import {
  analysisGraphSchemaVersion,
  resolveAnalysisLimits,
  validateGraph as validateAnalysisGraph,
} from './graph.ts'
import type {
  AnalysisMigrationPlan,
  AppliedMigration,
  InspectMigrationOptions,
} from './migrations.ts'
import {
  AnalysisMigrationRegistry,
  applyMigrationPlan as applyAnalysisMigrationPlan,
  describeAnalysisMigration,
  inspectMigrationPlan as inspectAnalysisMigrationPlan,
} from './migrations.ts'
import type { AnalysisDryRun, AnalysisInputBinding, PreparedAnalysisPlan } from './planner.ts'
import { dryRun as inspectDryRun, planGraph as prepareGraphPlan } from './planner.ts'
import type {
  AnalysisCommandApplication,
  AnalysisCommandValidation,
  AnalysisWorkspaceRoiContext,
  AnalysisWorkspaceSnapshot,
} from './workspace.ts'
import {
  applyCommand as applyWorkspaceCommand,
  createAnalysisWorkspaceSnapshot,
  validateCommand as validateWorkspaceCommand,
} from './workspace.ts'
import type { RoiSet } from './roi.ts'
import { resolveRoiLimits, roiSchemaVersion, roiSetValueTypeId, roiValueTypeId } from './roi.ts'

export interface AnalysisControllerCapabilities extends OperationJsonObject {
  readonly apiVersion: 1
  readonly graphSchemaVersion: 1
  readonly operationDescriptors: readonly OperationJsonObject[]
  readonly valueTypeDescriptors: readonly OperationJsonObject[]
  readonly providerDescriptors: readonly OperationJsonObject[]
  readonly migrationDescriptors: readonly OperationJsonObject[]
  readonly commandKinds: readonly string[]
  readonly roi: OperationJsonObject | null
  readonly trustBoundary: string
}

export interface AnalysisControllerOptions {
  readonly operations: OperationRegistry
  readonly valueTypes: ValueTypeRegistry
  readonly providers?: Iterable<OperationProvider>
  readonly migrations?: AnalysisMigrationRegistry
  readonly limits?: Readonly<AnalysisLimits>
  readonly roi?: Readonly<AnalysisWorkspaceRoiContext>
  readonly library: AnalysisLibraryBuild
}

export interface ControllerPlanOptions {
  readonly bindings: Readonly<Record<string, AnalysisInputBinding>>
  readonly policy?: OperationProviderPolicy
  readonly signal?: AbortSignal
}

export interface ControllerExecuteOptions {
  readonly inputIdentities?: Readonly<Record<string, SourceIdentity>>
  readonly signal?: AbortSignal
}

const descriptorObject = (value: unknown): OperationJsonObject =>
  normalizeOperationJsonObject(value)

export class AnalysisController {
  readonly #operations: OperationRegistry
  readonly #valueTypes: ValueTypeRegistry
  readonly #providers: readonly OperationProvider[]
  readonly #migrations: AnalysisMigrationRegistry
  readonly #limits: Readonly<AnalysisLimits>
  readonly #roiContext: Readonly<AnalysisWorkspaceRoiContext> | undefined
  readonly #library: AnalysisLibraryBuild
  readonly #tasks = new Map<string, AnalysisExecutionTask>()
  readonly capabilities: AnalysisControllerCapabilities

  constructor(options: Readonly<AnalysisControllerOptions>) {
    this.#operations = options.operations
    this.#valueTypes = options.valueTypes
    for (const operation of this.#operations.definitions()) {
      for (const port of [...operation.descriptor.inputs, ...operation.descriptor.outputs]) {
        const found =
          port.valueType.version === undefined
            ? this.#valueTypes
                .definitions()
                .some((definition) => definition.descriptor.id === port.valueType.id)
            : this.#valueTypes.get(port.valueType.id, port.valueType.version) !== undefined
        if (!found) {
          throw invalidInput(
            `Operation ${operation.descriptor.id}@${operation.descriptor.version} references unregistered value type ${port.valueType.id}`,
          )
        }
      }
    }
    this.#providers = Object.freeze([...(options.providers ?? [])])
    const providerKeys = new Set<string>()
    for (const provider of this.#providers) {
      const descriptor = normalizeOperationProviderDescriptor(provider.descriptor)
      const key = `${descriptor.id}\u0000${descriptor.version}`
      if (providerKeys.has(key)) {
        throw invalidInput(
          `Operation provider already registered: ${descriptor.id}@${descriptor.version}`,
        )
      }
      providerKeys.add(key)
    }
    this.#migrations = options.migrations ?? new AnalysisMigrationRegistry([])
    this.#limits = resolveAnalysisLimits(options.limits)
    this.#roiContext = options.roi
    if (
      this.#roiContext !== undefined &&
      (this.#valueTypes.get(roiValueTypeId, 1)?.descriptor.builtIn !== true ||
        this.#valueTypes.get(roiSetValueTypeId, 1)?.descriptor.builtIn !== true)
    ) {
      throw invalidInput('ROI controller context requires the core ROI and ROI-set value types')
    }
    if (
      typeof options.library.version !== 'string' ||
      options.library.version.trim().length === 0 ||
      typeof options.library.buildFingerprint !== 'string' ||
      options.library.buildFingerprint.trim().length === 0
    ) {
      throw invalidInput('Analysis library version and build fingerprint must be non-empty')
    }
    this.#library = Object.freeze({ ...options.library })
    this.capabilities = Object.freeze({
      apiVersion: 1,
      graphSchemaVersion: analysisGraphSchemaVersion,
      operationDescriptors: Object.freeze(
        options.operations.capabilitySnapshot.operations.map((entry) => descriptorObject(entry)),
      ),
      valueTypeDescriptors: Object.freeze(
        options.valueTypes.capabilitySnapshot.valueTypes.map((entry) => descriptorObject(entry)),
      ),
      providerDescriptors: Object.freeze(
        this.#providers.map((provider) => descriptorObject(provider.descriptor)),
      ),
      migrationDescriptors: Object.freeze(
        this.#migrations.definitions().map(describeAnalysisMigration),
      ),
      commandKinds: Object.freeze([
        'add-node',
        'remove-node',
        'connect',
        'disconnect',
        'update-parameters',
        'bind-input',
        'unbind-input',
        'set-output',
        'remove-output',
        ...(this.#roiContext === undefined
          ? []
          : ['add-roi', 'update-roi', 'remove-roi', 'replace-roi-set']),
      ]),
      roi:
        this.#roiContext === undefined
          ? null
          : Object.freeze({
              schemaVersion: roiSchemaVersion,
              limits: Object.freeze({ ...resolveRoiLimits(this.#roiContext.limits) }),
              commandKinds: Object.freeze([
                'add-roi',
                'update-roi',
                'remove-roi',
                'replace-roi-set',
              ]),
            }),
      trustBoundary:
        'Trusted in-process API, not a sandbox; untrusted extensions require a future Worker or iframe RPC host',
    })
    Object.freeze(this)
  }

  describeOperation(id: string, version: number): OperationJsonObject | undefined {
    const descriptor = this.#operations.get(id, version)?.descriptor
    return descriptor === undefined ? undefined : descriptorObject(descriptor)
  }

  normalizeOperationParameters(
    id: string,
    version: number,
    parameters: unknown,
  ): OperationValidationResult<OperationJsonValue> {
    const definition = this.#operations.get(id, version)
    if (definition !== undefined) return definition.normalizeParameters(parameters)
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        Object.freeze({
          code: 'invalid-id' as const,
          path: '/operation',
          message: `Unknown operation ${id}@${version}`,
        }),
      ]),
    })
  }

  createWorkspace(graph?: AnalysisGraph, roiSet?: RoiSet): AnalysisWorkspaceSnapshot {
    return createAnalysisWorkspaceSnapshot(graph, 0, roiSet, this.#roiContext)
  }

  validateCommand(command: unknown): AnalysisCommandValidation {
    return validateWorkspaceCommand(command, this.#roiContext)
  }

  applyCommand(snapshot: AnalysisWorkspaceSnapshot, command: unknown): AnalysisCommandApplication {
    return applyWorkspaceCommand(
      snapshot,
      command,
      this.#operations,
      this.#limits,
      this.#roiContext,
    )
  }

  validateGraph(graph: unknown): AnalysisGraphValidation {
    return validateAnalysisGraph(graph, this.#operations, this.#limits)
  }

  inspectMigrationPlan(
    graph: unknown,
    options: Readonly<InspectMigrationOptions>,
  ): AnalysisMigrationPlan {
    return inspectAnalysisMigrationPlan(graph, this.#migrations, options)
  }

  applyMigrationPlan(graph: unknown, plan: AnalysisMigrationPlan): Promise<AppliedMigration> {
    return applyAnalysisMigrationPlan(graph, plan, this.#migrations, this.#operations, this.#limits)
  }

  planGraph(
    graph: unknown,
    options: Readonly<ControllerPlanOptions>,
  ): Promise<PreparedAnalysisPlan> {
    return prepareGraphPlan({
      graph,
      operations: this.#operations,
      valueTypes: this.#valueTypes,
      providers: this.#providers,
      bindings: options.bindings,
      limits: this.#limits,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  dryRun(graph: unknown, options: Readonly<ControllerPlanOptions>): Promise<AnalysisDryRun> {
    return inspectDryRun({
      graph,
      operations: this.#operations,
      valueTypes: this.#valueTypes,
      providers: this.#providers,
      bindings: options.bindings,
      limits: this.#limits,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  executeGraph(
    plan: PreparedAnalysisPlan,
    options: Readonly<ControllerExecuteOptions> = {},
  ): AnalysisExecutionTask {
    const task = startExecution({
      plan,
      library: this.#library,
      limits: this.#limits,
      ...(options.inputIdentities === undefined
        ? {}
        : { inputIdentities: options.inputIdentities }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    this.#tasks.set(task.id, task)
    task.result.then(
      () => this.#tasks.delete(task.id),
      () => this.#tasks.delete(task.id),
    )
    return task
  }

  cancel(taskId: string, reason?: unknown): boolean {
    const task = this.#tasks.get(taskId)
    if (task === undefined) return false
    task.cancel(reason)
    return true
  }
}

export const createAnalysisController = (
  options: Readonly<AnalysisControllerOptions>,
): AnalysisController => new AnalysisController(options)
