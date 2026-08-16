import { readImageNode } from '@itk-wasm/image-io'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  bytesOfView,
  correctnessFromView,
  now,
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
} from './node-common.ts'

const run = async (context: NodeCompetitorContext): Promise<NodeCompetitorExecution> => {
  const resource =
    context.fixture.resources.find(({ id }) => id === 'primary') ?? context.fixture.resources[0]
  if (resource === undefined)
    throw new Error(`Fixture ${context.fixture.id} has no primary resource`)
  const started = now()
  const bridgeStarted = now()
  const stagingDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-itk-'))
  let stagedPrimaryPath = join(stagingDirectory, resource.name ?? basename(resource.path))
  let stagedBytes = 0
  try {
    for (const entry of context.fixture.resources) {
      const bytes = await readFile(entry.path)
      await writeFile(join(stagingDirectory, entry.name ?? basename(entry.path)), bytes)
      stagedBytes += bytes.byteLength
      context.source.recordFilesystemRead(entry.id)
    }
    stagedPrimaryPath = join(stagingDirectory, resource.name ?? basename(resource.path))
    context.source.recordInputCopy(stagedBytes)
    const inputBridgeMilliseconds = now() - bridgeStarted
    const openStarted = now()
    const image = await readImageNode(stagedPrimaryPath, {
      ...(context.workload.operation === 'metadata' ? { informationOnly: true } : {}),
    })
    const openMilliseconds = now() - openStarted
    const details = [
      `format=${resource.name ?? 'unknown'}`,
      `size=${image.size.join('x')}`,
      `spacing=${image.spacing.join(',')}`,
      `origin=${image.origin.join(',')}`,
      `workerModuleInit=Node pipeline`,
    ]
    if (context.workload.operation === 'metadata') {
      return {
        stages: {
          moduleImportMilliseconds: 0,
          wasmInitializationMilliseconds: 0,
          inputCopyMilliseconds: 0,
          inputBridgeMilliseconds,
          openMilliseconds,
          hierarchyMilliseconds: 0,
          readMilliseconds: 0,
          outputTransferMilliseconds: 0,
          firstUsableDataMilliseconds: now() - started,
        },
        sourceInstrumentation: 'filesystem',
        correctness: {
          shape: image.size,
          nativeSampleType: null,
          sampleSha256: null,
          sampleCount: null,
          outputBytes: 0,
          details,
        },
        cleanup: async () => rm(stagingDirectory, { recursive: true, force: true }),
      }
    }
    if (image.data === null) throw new Error('@itk-wasm/image-io returned no image data')
    const transferStarted = now()
    const transferred = new Uint8Array(image.data.byteLength)
    transferred.set(bytesOfView(image.data))
    const outputTransferMilliseconds = now() - transferStarted
    if (context.workload.operation === 'selected') {
      details.push('selectedSlice=post-read full image; no public ITK selection API used')
    }
    return {
      stages: {
        moduleImportMilliseconds: 0,
        wasmInitializationMilliseconds: 0,
        inputCopyMilliseconds: 0,
        inputBridgeMilliseconds,
        openMilliseconds,
        hierarchyMilliseconds: 0,
        readMilliseconds: openMilliseconds,
        outputTransferMilliseconds,
        firstUsableDataMilliseconds: now() - started,
      },
      sourceInstrumentation: 'filesystem',
      correctness: correctnessFromView(image.data, image.size, details),
      cleanup: async () => rm(stagingDirectory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
