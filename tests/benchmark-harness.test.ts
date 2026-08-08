import { describe, expect, it } from 'vitest'
import { engine as imageJsEngine } from '../benchmark/engines/image-js.ts'
import { engine as jimpEngine } from '../benchmark/engines/jimp.ts'
import { engine as sharpSingleThreadEngine } from '../benchmark/engines/sharp-single-thread.ts'
import { engine as sharpEngine } from '../benchmark/engines/sharp.ts'
import { summarizeSamples } from '../benchmark/lib/results.ts'
import { validateExecution } from '../benchmark/lib/validate-output.ts'
import type { PipelineWorkflow } from '../benchmark/types.ts'
import { workflowsForProfile } from '../benchmark/workflows.ts'

const competitorWorkflow = (id: string): PipelineWorkflow => {
  const workflow = workflowsForProfile('competitors').find((candidate) => candidate.id === id)
  if (!workflow || workflow.batch) throw new Error(`Missing competitor workflow: ${id}`)
  return workflow
}

describe('competitor benchmark classification', () => {
  it('classifies unsupported operations before execution', async () => {
    const autoOrient = competitorWorkflow('auto-orient-6')
    const webp = competitorWorkflow('webp-large-resize-jpeg')

    await expect(
      Promise.resolve(imageJsEngine.unsupportedReason(autoOrient, [])),
    ).resolves.toContain('does not expose EXIF auto-orientation')
    await expect(Promise.resolve(imageJsEngine.unsupportedReason(webp, []))).resolves.toContain(
      'no WebP decoder',
    )
    await expect(Promise.resolve(jimpEngine.unsupportedReason(webp, []))).resolves.toContain(
      'no WebP decoder',
    )
  })

  it('cannot aggregate invalid output as a successful timing', () => {
    const workflow = competitorWorkflow('metadata-jpeg-large')
    const validation = validateExecution({
      workflow,
      execution: { metadata: { format: 'jpeg', width: 1, height: 1 } },
    })
    expect(validation.valid).toBe(false)

    const summary = summarizeSamples([{ status: 'invalid-output', errors: validation.errors }])
    expect(summary.status).toBe('invalid-output')
    expect(summary.wallMilliseconds).toBeUndefined()
    expect(summary.successfulSamples).toBeUndefined()
  })

  it('keeps Sharp default and single-thread configurations identifiable', () => {
    expect(sharpEngine.id).toBe('sharp')
    expect(sharpEngine.kind).toBe('native')
    expect(sharpSingleThreadEngine.id).toBe('sharp-single-thread')
    expect(sharpSingleThreadEngine.kind).toBe('native-single-thread')
    expect(sharpSingleThreadEngine.version).toBe(sharpEngine.version)
  })
})
