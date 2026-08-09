import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { engine as imageJsEngine } from '../benchmark/engines/image-js.ts'
import { engine as jimpEngine } from '../benchmark/engines/jimp.ts'
import { engine as jsquashEngine } from '../benchmark/engines/jsquash.ts'
import { engine as sharpSingleThreadEngine } from '../benchmark/engines/sharp-single-thread.ts'
import { engine as sharpEngine } from '../benchmark/engines/sharp.ts'
import { createQualityReference, measureQualityPsnr } from '../benchmark/lib/quality.ts'
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
    await expect(
      Promise.resolve(
        jsquashEngine.unsupportedReason(competitorWorkflow('metadata-jpeg-large'), []),
      ),
    ).resolves.toContain('no metadata inspection API')
    await expect(
      Promise.resolve(jsquashEngine.unsupportedReason(competitorWorkflow('jpeg-crop-resize'), [])),
    ).resolves.toContain('exact crop coordinates')
    await expect(
      Promise.resolve(jsquashEngine.unsupportedReason(competitorWorkflow('png-to-jpeg'), [])),
    ).resolves.toContain('flattening alpha')
  })

  it('cannot aggregate invalid output as a successful timing', async () => {
    const workflow = competitorWorkflow('metadata-jpeg-large')
    const validation = await validateExecution({
      workflow,
      execution: { metadata: { format: 'jpeg', width: 1, height: 1 } },
    })
    expect(validation.valid).toBe(false)

    const summary = summarizeSamples([{ status: 'invalid-output', errors: validation.errors }])
    expect(summary.status).toBe('invalid-output')
    expect(summary.wallMilliseconds).toBeUndefined()
    expect(summary.successfulSamples).toBeUndefined()
  })

  it('rejects structurally valid WebP whose oracle-decoded pixels are invalid', async () => {
    const workflow: PipelineWorkflow = {
      id: 'invalid-webp-pixels',
      title: 'Invalid WebP pixels',
      tier: 'webp',
      input: 'unused',
      operations: [],
      expected: {
        format: 'webp',
        width: 2,
        height: 2,
        pixelSamples: [{ x: 1, y: 1, red: 255, green: 255, blue: 255, tolerance: 0 }],
      },
    }
    const output = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#000000' },
    })
      .webp({ lossless: true })
      .toBuffer()
    const validation = await validateExecution({ workflow, execution: { output } })

    expect(validation.valid).toBe(false)
    expect(validation.errors.join('; ')).toContain('pixel (1, 1) red')
    const summary = summarizeSamples([{ status: 'invalid-output', errors: validation.errors }])
    expect(summary.wallMilliseconds).toBeUndefined()
  })

  it('records exact-area PSNR without treating transparent RGB as visible error', () => {
    const source = new PNG({ width: 4, height: 4 })
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const offset = (y * 4 + x) * 4
        source.data[offset] = x < 2 ? 20 : 180
        source.data[offset + 1] = y < 2 ? 40 : 200
        source.data[offset + 2] = 90
        source.data[offset + 3] = x < 2 && y < 2 ? 0 : 255
      }
    }
    const workflow: PipelineWorkflow = {
      id: 'quality-oracle',
      title: 'Quality oracle',
      tier: 'smoke',
      qualityReference: 'exact-area',
      input: 'unused',
      operations: [
        { type: 'resize', width: 2, height: 2 },
        { type: 'encode', format: 'png', compressionLevel: 6 },
      ],
      expected: { format: 'png', width: 2, height: 2 },
    }
    const reference = createQualityReference(workflow, PNG.sync.write(source))
    const exact = new PNG({ width: 2, height: 2 })
    exact.data.set([255, 0, 0, 0, 180, 40, 90, 255, 20, 200, 90, 255, 180, 200, 90, 255])
    const exactOutput = PNG.sync.write(exact)
    expect(measureQualityPsnr(exactOutput, reference)).toBe('exact')

    exact.data[4] = 179
    const measured = measureQualityPsnr(PNG.sync.write(exact), reference)
    if (typeof measured !== 'number') throw new Error('Expected a finite PSNR')
    expect(measured).toBeGreaterThan(60)

    const memory = process.memoryUsage()
    const summary = summarizeSamples([
      {
        status: 'pass',
        errors: [],
        outputBytes: exactOutput.byteLength,
        wallMilliseconds: 1,
        cpuMilliseconds: 1,
        finalMemory: memory,
        resourceMaxRssBytes: memory.rss,
        peakRssBytes: memory.rss,
        peakRssDeltaBytes: 0,
        qualityPsnrDb: measured,
      },
    ])
    expect(summary.qualityPsnrDb).toBe(measured)
  })

  it('keeps Sharp default and single-thread configurations identifiable', () => {
    expect(sharpEngine.id).toBe('sharp')
    expect(sharpEngine.kind).toBe('native')
    expect(sharpSingleThreadEngine.id).toBe('sharp-single-thread')
    expect(sharpSingleThreadEngine.kind).toBe('native-single-thread')
    expect(sharpSingleThreadEngine.version).toBe(sharpEngine.version)
  })

  it('identifies jSquash as a multi-package WebAssembly engine', () => {
    expect(jsquashEngine.id).toBe('jsquash')
    expect(jsquashEngine.kind).toBe('webassembly')
    expect(jsquashEngine.version).toContain('resize 2.1.1')
    expect(jsquashEngine.packageNames).toEqual([
      '@jsquash/jpeg',
      '@jsquash/png',
      '@jsquash/webp',
      '@jsquash/resize',
    ])
  })
})
