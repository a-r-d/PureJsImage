import { MemorySource } from 'purejsimage'
import {
  analysisConnectedComponentsOperationId,
  analysisSelectResolutionLevelOperationId,
  analysisStatisticsOperationId,
  analysisThresholdOperationId,
  computeAnalysisProjectHashes,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  type AnalysisExecutionResult,
  type AnalysisGraph,
  type AnalysisProjectV1,
  type AnalysisResultSummary,
  type PreparedAnalysisPlan,
} from 'purejsimage/analysis'
import { createTileRuntime } from 'purejsimage/analysis/runtime'
import { summarizeResult, validateAnalysisResult } from 'purejsimage/analysis/results'
import {
  canonicalNormalizedRoiSemanticsJson,
  normalizeRoi,
  roiValueTypeId,
} from 'purejsimage/analysis/roi'
import { hashCanonicalJson } from 'purejsimage/analysis/project'
import {
  createScientificLibrary,
  getScientificDatasetIdentity,
  resolveNumericTileSource,
} from 'purejsimage/scientific'
import { encodeGsf, gsfReader } from 'purejsimage/scientific/readers/gsf'
import { aperioSvsReader } from 'purejsimage/scientific/readers/aperio-svs'

export interface ApplicationPlatformExampleResult {
  readonly projectJson: string
  readonly result: AnalysisResultSummary
}

/** Public-package-only WSI to deterministic object-table pipeline. */
export const runWholeSlideConnectedComponentsExample = async (
  svsBytes: Uint8Array,
  signal?: AbortSignal,
): Promise<AnalysisResultSummary> => {
  const science = createScientificLibrary({ readers: [aperioSvsReader] })
  const document = await science.open({
    primary: { id: 'slide-file', name: 'slide.svs', source: new MemorySource(svsBytes) },
    readerId: aperioSvsReader.descriptor.id,
    ...(signal === undefined ? {} : { signal }),
  })
  const dataset = await document.openDataset('pyramid', signal === undefined ? {} : { signal })
  const identity = getScientificDatasetIdentity(dataset)
  if (identity === undefined) throw new Error('The opened WSI dataset has no source identity')
  const runtime = createTileRuntime({
    limits: {
      maxTotalManagedBytes: 128 * 1_024 * 1_024,
      maxOperationWorkingBytes: 64 * 1_024 * 1_024,
      maxConcurrency: 2,
    },
  })
  const bundle = createBuiltInAnalysisBundle({ descriptor: dataset.descriptor, runtime })
  const controller = createAnalysisController({
    ...bundle,
    library: { version: '0.9.0', buildFingerprint: 'wsi-connected-components-example-v1' },
  })
  const graph: AnalysisGraph = Object.freeze({
    schemaVersion: 1,
    inputs: Object.freeze([
      Object.freeze({
        name: 'source',
        valueType: { id: scientificDatasetValueTypeId, version: 1 },
      }),
    ]),
    nodes: Object.freeze([
      Object.freeze({
        id: 'level',
        operation: { id: analysisSelectResolutionLevelOperationId, version: 1 },
        inputs: Object.freeze([
          Object.freeze({ port: 'dataset', source: { kind: 'input' as const, input: 'source' } }),
        ]),
        parameters: Object.freeze({ level: 0 }),
      }),
      Object.freeze({
        id: 'threshold',
        operation: { id: analysisThresholdOperationId, version: 1 },
        inputs: Object.freeze([
          Object.freeze({
            port: 'dataset',
            source: { kind: 'node' as const, nodeId: 'level', output: 'dataset' },
          }),
        ]),
        parameters: Object.freeze({ mode: 'less-than', component: 0, threshold: 220 }),
      }),
      Object.freeze({
        id: 'objects',
        operation: { id: analysisConnectedComponentsOperationId, version: 1 },
        inputs: Object.freeze([
          Object.freeze({
            port: 'dataset',
            source: { kind: 'node' as const, nodeId: 'threshold', output: 'dataset' },
          }),
        ]),
        parameters: Object.freeze({
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          component: 0,
          connectivity: 8,
        }),
      }),
    ]),
    outputs: Object.freeze([
      Object.freeze({
        name: 'objects',
        source: { kind: 'node' as const, nodeId: 'objects', output: 'objects' },
      }),
    ]),
  })
  const options = {
    bindings: {
      source: {
        value: dataset,
        identity,
        characteristics: scientificDatasetCharacteristics(dataset),
      },
    },
    policy: {
      mode: 'pinned' as const,
      providerId: 'purejsimage.analysis.reference',
      providerVersion: 1,
    },
    ...(signal === undefined ? {} : { signal }),
  }
  let plan: PreparedAnalysisPlan | undefined
  let execution: AnalysisExecutionResult | undefined
  try {
    const dryRun = await controller.dryRun(graph, options)
    if (!dryRun.valid) throw new Error(`WSI graph dry-run failed: ${JSON.stringify(dryRun.issues)}`)
    plan = await controller.planGraph(graph, options)
    execution = await controller.executeGraph(plan, signal === undefined ? {} : { signal }).result
    return summarizeResult(validateAnalysisResult(execution.outputs.get('objects')), {
      maxPreviewValues: 8,
    })
  } finally {
    try {
      if (execution !== undefined) await execution.release()
    } finally {
      try {
        if (plan !== undefined) await plan.dispose()
      } finally {
        try {
          await runtime.dispose()
        } finally {
          await document.close?.()
        }
      }
    }
  }
}

/**
 * Complete bounded application-platform lifecycle using only installed package exports.
 * Replace the in-memory GSF resource with a browser File or HTTP Range-backed ImageSource.
 */
export const runApplicationPlatformExample = async (
  signal?: AbortSignal,
): Promise<ApplicationPlatformExampleResult> => {
  const source = new MemorySource(
    encodeGsf({
      width: 4,
      height: 4,
      values: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    }),
  )
  const science = createScientificLibrary({ readers: [gsfReader] })
  const document = await science.open({
    primary: { id: 'surface-file', name: 'surface.gsf', source },
    ...(signal === undefined ? {} : { signal }),
  })
  const runtime = createTileRuntime({
    limits: { maxTotalManagedBytes: 8 * 1_024 * 1_024, maxConcurrency: 2 },
  })
  let plan: PreparedAnalysisPlan | undefined
  let execution: AnalysisExecutionResult | undefined

  try {
    const selected = document.datasets[0]
    if (selected === undefined) throw new Error('The document contains no scientific dataset')
    const dataset = await document.openDataset(selected.id, signal === undefined ? {} : { signal })
    const datasetIdentity = getScientificDatasetIdentity(dataset)
    if (datasetIdentity === undefined) throw new Error('The opened dataset has no source identity')
    const fixedIndices = Object.freeze([])

    // NumericTile storage is native-endian and must be released by its consumer.
    for await (const tile of resolveNumericTileSource(dataset).readNumericTiles({
      displayAxes: ['x', 'y'],
      fixedIndices,
      resolutionLevel: 0,
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      ...(signal === undefined ? {} : { signal }),
    })) {
      tile.release()
    }

    const roi = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'center',
        axisIds: ['x', 'y'],
        fixedIndices,
        coordinateSpace: 'pixel',
        geometry: { kind: 'rectangle', x: 1, y: 1, width: 2, height: 2 },
      },
      dataset.descriptor,
    )
    const graph: AnalysisGraph = Object.freeze({
      schemaVersion: 1,
      inputs: Object.freeze([
        Object.freeze({
          name: 'source',
          valueType: { id: scientificDatasetValueTypeId, version: 1 },
        }),
        Object.freeze({ name: 'selection', valueType: { id: roiValueTypeId, version: 1 } }),
      ]),
      nodes: Object.freeze([
        Object.freeze({
          id: 'statistics',
          operation: { id: analysisStatisticsOperationId, version: 1 },
          inputs: Object.freeze([
            Object.freeze({
              port: 'dataset',
              source: { kind: 'input' as const, input: 'source' },
            }),
            Object.freeze({
              port: 'roi',
              source: { kind: 'input' as const, input: 'selection' },
            }),
          ]),
          parameters: Object.freeze({
            displayAxes: ['x', 'y'],
            fixedIndices,
            component: 0,
            percentiles: [50],
            percentileMaxSamples: 1_024,
            emptyPolicy: 'error',
          }),
        }),
      ]),
      outputs: Object.freeze([
        Object.freeze({
          name: 'statistics',
          source: { kind: 'node' as const, nodeId: 'statistics', output: 'statistics' },
        }),
      ]),
    })

    const bundle = createBuiltInAnalysisBundle({ descriptor: dataset.descriptor, runtime })
    const controller = createAnalysisController({
      ...bundle,
      roi: { descriptor: dataset.descriptor },
      library: { version: '0.9.0', buildFingerprint: 'application-platform-example-v1' },
    })
    const roiDomain = 'purejsimage.roi-semantics.v1'
    const roiIdentity = Object.freeze({
      kind: 'semantic-json' as const,
      domain: roiDomain,
      sha256: await hashCanonicalJson(roiDomain, canonicalNormalizedRoiSemanticsJson(roi)),
    })
    const bindings = Object.freeze({
      source: Object.freeze({
        value: dataset,
        identity: datasetIdentity,
        characteristics: scientificDatasetCharacteristics(dataset),
      }),
      selection: Object.freeze({ value: roi, identity: roiIdentity }),
    })
    const providerPolicy = Object.freeze({
      mode: 'pinned' as const,
      providerId: 'purejsimage.analysis.reference',
      providerVersion: 1,
    })
    const executionOptions = {
      bindings,
      policy: providerPolicy,
      ...(signal === undefined ? {} : { signal }),
    }
    const dryRun = await controller.dryRun(graph, executionOptions)
    if (!dryRun.valid) throw new Error(`Graph dry-run failed: ${JSON.stringify(dryRun.issues)}`)

    plan = await controller.planGraph(graph, executionOptions)
    execution = await controller.executeGraph(plan, signal === undefined ? {} : { signal }).result
    const output = execution.outputs.get('statistics')
    const result = summarizeResult(validateAnalysisResult(output))

    const projectWithoutHashes = Object.freeze({
      schemaVersion: 1 as const,
      graph,
      roiSet: Object.freeze({ schemaVersion: 1 as const, rois: Object.freeze([roi]) }),
      bindings: Object.freeze([
        Object.freeze({
          input: 'source',
          valueType: { id: scientificDatasetValueTypeId, version: 1 },
          identity: datasetIdentity,
          value: { kind: 'source' as const, sourceReference: 'surface-file' },
        }),
        Object.freeze({
          input: 'selection',
          valueType: { id: roiValueTypeId, version: 1 },
          identity: roiIdentity,
          value: { kind: 'roi' as const, roiId: roi.id },
        }),
      ]),
      sourceReferences: Object.freeze([
        Object.freeze({ id: 'surface-file', identity: datasetIdentity }),
      ]),
      providerPolicy,
      createdWith: Object.freeze({
        packageVersion: '0.9.0',
        buildFingerprint: 'application-platform-example-v1',
      }),
    })
    const project: AnalysisProjectV1 = Object.freeze({
      ...projectWithoutHashes,
      hashes: await computeAnalysisProjectHashes(projectWithoutHashes),
    })
    return Object.freeze({ projectJson: JSON.stringify(project), result })
  } finally {
    try {
      if (execution !== undefined) await execution.release()
    } finally {
      try {
        if (plan !== undefined) await plan.dispose()
      } finally {
        try {
          await runtime.dispose()
        } finally {
          await document.close?.()
        }
      }
    }
  }
}
