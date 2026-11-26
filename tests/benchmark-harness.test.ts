import { existsSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { engine as imageJsEngine } from '../benchmark/engines/image-js.ts'
import { engine as imageScriptEngine } from '../benchmark/engines/imagescript.ts'
import { engine as jimpEngine } from '../benchmark/engines/jimp.ts'
import { engine as jsquashEngine } from '../benchmark/engines/jsquash.ts'
import { engine as pureJsImageEngine } from '../benchmark/engines/purejsimage.ts'
import { engine as pureJsImageExperimentalHeicEngine } from '../benchmark/engines/purejsimage-experimental-heic.ts'
import { engine as pureJsImageWasmEngine } from '../benchmark/engines/purejsimage-wasm.ts'
import { engine as sharpEngine } from '../benchmark/engines/sharp.ts'
import { engine as sharpSingleThreadEngine } from '../benchmark/engines/sharp-single-thread.ts'
import { createQualityReference, measureQualityPsnr } from '../benchmark/lib/quality.ts'
import { summarizeSamples } from '../benchmark/lib/results.ts'
import { validateExecution } from '../benchmark/lib/validate-output.ts'
import type { PipelineWorkflow } from '../benchmark/types.ts'
import { workflowsForProfile } from '../benchmark/workflows.ts'
import packageJson from '../package.json' with { type: 'json' }
import { Image } from './image-library.ts'

const competitorWorkflow = (id: string): PipelineWorkflow => {
  const workflow = workflowsForProfile('competitors').find((candidate) => candidate.id === id)
  if (!workflow || workflow.batch) throw new Error(`Missing competitor workflow: ${id}`)
  return workflow
}

const webCodecWorkflow = (id: string): PipelineWorkflow => {
  const workflow = workflowsForProfile('web-codecs').find((candidate) => candidate.id === id)
  if (!workflow || workflow.batch) throw new Error(`Missing web-codecs workflow: ${id}`)
  return workflow
}

describe('competitor benchmark classification', () => {
  it('marks Sharp HEIC unsupported exactly when the installed build cannot decode the pixels', async () => {
    const heic = competitorWorkflow('heif-iphone-resize-jpeg')
    const input = readFileSync('benchmark/corpus/files/iphone12-greyhounds-4032x3024.heic')
    const decodes = await sharp(input)
      .raw()
      .toBuffer()
      .then(
        () => true,
        () => false,
      )

    const reason = await sharpEngine.unsupportedReason(heic, [input])

    expect(reason === undefined).toBe(decodes)
  })

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
    await expect(
      Promise.resolve(
        pureJsImageEngine.unsupportedReason(competitorWorkflow('heif-iphone-resize-jpeg'), []),
      ),
    ).resolves.toContain('do not include experimental HEIF/HEIC')
    await expect(
      Promise.resolve(
        pureJsImageWasmEngine.unsupportedReason(competitorWorkflow('heif-iphone-resize-jpeg'), []),
      ),
    ).resolves.toContain('do not include experimental HEIF/HEIC')
    await expect(
      Promise.resolve(
        pureJsImageExperimentalHeicEngine.unsupportedReason(
          competitorWorkflow('heif-iphone-resize-jpeg'),
          [],
        ),
      ),
    ).resolves.toBeUndefined()
  })

  it('classifies the expanded common-web jobs without approximating them', async () => {
    const avifCrop = webCodecWorkflow('avif-fox-crop-resize-jpeg')
    const jpegToAvif = webCodecWorkflow('jpeg-to-avif')
    const jpegToWebp = webCodecWorkflow('jpeg-to-webp-lossy')
    const progressive = webCodecWorkflow('jpeg-progressive-resize-1200')
    const lambdaJpeg = webCodecWorkflow('lambda-twilio-mms-jpeg-1024')
    const losslessAlpha = webCodecWorkflow('webp-lossless-alpha-png')

    await expect(Promise.resolve(jsquashEngine.unsupportedReason(avifCrop, []))).resolves.toContain(
      'exact crop coordinates',
    )
    await expect(Promise.resolve(jimpEngine.unsupportedReason(jpegToAvif, []))).resolves.toContain(
      'no AVIF encoder',
    )
    await expect(
      Promise.resolve(imageJsEngine.unsupportedReason(jpegToAvif, [])),
    ).resolves.toContain('no AVIF encoder')
    await expect(Promise.resolve(jimpEngine.unsupportedReason(jpegToWebp, []))).resolves.toContain(
      'no WebP encoder',
    )
    await expect(
      Promise.resolve(imageJsEngine.unsupportedReason(jpegToWebp, [])),
    ).resolves.toContain('no WebP encoder')
    await expect(
      Promise.resolve(jimpEngine.unsupportedReason(losslessAlpha, [])),
    ).resolves.toContain('no WebP decoder')
    await expect(
      Promise.resolve(imageJsEngine.unsupportedReason(losslessAlpha, [])),
    ).resolves.toContain('no WebP decoder')
    await expect(
      Promise.resolve(jsquashEngine.unsupportedReason(jpegToAvif, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(jsquashEngine.unsupportedReason(jpegToWebp, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(jsquashEngine.unsupportedReason(progressive, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(jsquashEngine.unsupportedReason(lambdaJpeg, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(imageJsEngine.unsupportedReason(progressive, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(imageJsEngine.unsupportedReason(lambdaJpeg, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(jimpEngine.unsupportedReason(progressive, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(jimpEngine.unsupportedReason(lambdaJpeg, [])),
    ).resolves.toBeUndefined()
    await expect(
      Promise.resolve(pureJsImageEngine.unsupportedReason(jpegToAvif, [])),
    ).resolves.toBeUndefined()
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

  it('accepts the default Lanczos3 quarter turn and rejects a counter-clockwise turn', async () => {
    const fixture = 'benchmark/corpus/files/tundra-4000x3000.jpg'
    if (!existsSync(fixture)) return
    const workflow = workflowsForProfile('transforms-comparable').find(
      (candidate) => candidate.id === 'transform-quarter-turn-jpeg',
    )
    if (!workflow || workflow.batch) throw new Error('Missing quarter-turn workflow')
    const input = readFileSync(fixture)
    const turn = async (degrees: number): Promise<{ output: Uint8Array }> => ({
      output: await (await Image.open(input))
        .rotate(degrees)
        .resize({ width: 1200 })
        .jpeg({ quality: 80 })
        .toBuffer(),
    })

    const clockwise = await validateExecution({ workflow, execution: await turn(90) })
    const counterClockwise = await validateExecution({ workflow, execution: await turn(-90) })

    expect(clockwise.errors).toEqual([])
    expect(counterClockwise.valid).toBe(false)
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

  it('decodes outputs for validation only after peak-RSS sampling stops', () => {
    // Validating the warmup output and the measured output inside the sampled window added up to
    // 70 MiB to PNG output rows and let resident allocator pages swing some rows by about 30 MiB.
    const worker = readFileSync('benchmark/worker.ts', 'utf8')
    const measurementComplete = worker.indexOf("process.send?.({ type: 'measurement-complete' })")
    const validations = [...worker.matchAll(/validateExecution\(/g)].map((match) => match.index)
    expect(measurementComplete).toBeGreaterThan(0)
    expect(validations).toHaveLength(1)
    expect(validations[0]).toBeGreaterThan(measurementComplete)
  })

  it('reclaims warmup memory with a last-resort collection before peak-RSS sampling starts', () => {
    // Three plain gc() calls left 15 to 30 MiB of freed warmup memory resident, which split peak
    // RSS for identical runs into two clusters about 14 MiB apart.
    const worker = readFileSync('benchmark/worker.ts', 'utf8')
    const settle = worker.indexOf(
      "global.gc?.({ type: 'major', execution: 'sync', flavor: 'last-resort' })",
    )
    const settleCall = worker.indexOf('await settleGarbage()')
    const ready = worker.indexOf("type: 'ready'")
    expect(settle).toBeGreaterThan(0)
    expect(settleCall).toBeGreaterThan(settle)
    expect(ready).toBeGreaterThan(settleCall)
  })

  it('reports the installed comparator versions pinned in package.json', () => {
    expect(jimpEngine.version).toBe(packageJson.devDependencies.jimp)
    expect(imageJsEngine.version).toBe(packageJson.devDependencies['image-js'])
    expect(imageScriptEngine.version).toBe(packageJson.devDependencies.imagescript)
    expect(sharpEngine.version).toBe(packageJson.devDependencies.sharp)
  })

  it('keeps Sharp default and single-thread configurations identifiable', () => {
    expect(sharpEngine.id).toBe('sharp')
    expect(sharpEngine.kind).toBe('native')
    expect(sharpSingleThreadEngine.id).toBe('sharp-single-thread')
    expect(sharpSingleThreadEngine.kind).toBe('native-single-thread')
    expect(sharpSingleThreadEngine.version).toBe(sharpEngine.version)
  })
  it('identifies explicit PureJsImage WASM registration as a separate engine', () => {
    expect(pureJsImageWasmEngine.id).toBe('purejsimage-wasm')
    expect(pureJsImageWasmEngine.kind).toBe('webassembly')
    expect(pureJsImageWasmEngine.packageName).toBe('purejsimage')
    expect(pureJsImageWasmEngine.version).toContain('workspace WASM')
  })

  it('identifies experimental HEIC registration as a separate opt-in engine', () => {
    expect(pureJsImageExperimentalHeicEngine.id).toBe('purejsimage-experimental-heic')
    expect(pureJsImageExperimentalHeicEngine.kind).toBe('pure-javascript')
    expect(pureJsImageExperimentalHeicEngine.packageName).toBe('purejsimage')
    expect(pureJsImageExperimentalHeicEngine.version).toContain('experimental HEIC')
  })

  it('runs every web codec workflow through ImageScript and rejects HEIC and raw decode', async () => {
    for (const workflow of workflowsForProfile('web-codecs')) {
      await expect(
        Promise.resolve(imageScriptEngine.unsupportedReason(workflow, [])),
        workflow.id,
      ).resolves.toBeUndefined()
    }
    await expect(
      Promise.resolve(
        imageScriptEngine.unsupportedReason(competitorWorkflow('heif-iphone-resize-jpeg'), []),
      ),
    ).resolves.toContain('no HEIC decoder')
    const raw = workflowsForProfile('tiff').find((candidate) => candidate.id === 'tiff-large-raw')
    if (!raw) throw new Error('Missing tiff-large-raw workflow')
    await expect(Promise.resolve(imageScriptEngine.unsupportedReason(raw, []))).resolves.toContain(
      'no streaming raw-decode',
    )
  })

  it('resizes with ImageScript and flattens transparency onto the requested background', async () => {
    const source = new PNG({ width: 8, height: 4 })
    source.data.fill(0)
    const workflow: PipelineWorkflow = {
      id: 'imagescript-flatten',
      title: 'ImageScript flatten',
      tier: 'smoke',
      input: 'unused',
      operations: [
        { type: 'resize', width: 4 },
        { type: 'encode', format: 'jpeg', quality: 90, background: '#ffffff' },
      ],
      expected: { format: 'jpeg', width: 4, height: 2 },
    }

    const execution = await imageScriptEngine.execute({
      workflow,
      inputs: [PNG.sync.write(source)],
    })
    const validation = await validateExecution({ workflow, execution })
    if (!execution.output) throw new Error('ImageScript produced no output')
    const pixels = await sharp(execution.output).raw().toBuffer()

    expect(validation.errors).toEqual([])
    expect(Math.min(...pixels)).toBeGreaterThanOrEqual(250)
  })

  it('identifies jSquash as a multi-package WebAssembly engine', () => {
    expect(jsquashEngine.id).toBe('jsquash')
    expect(jsquashEngine.kind).toBe('webassembly')
    expect(jsquashEngine.version).toContain('avif 2.1.1')
    expect(jsquashEngine.version).toContain('resize 2.1.1')
    expect(jsquashEngine.packageNames).toEqual([
      '@jsquash/avif',
      '@jsquash/jpeg',
      '@jsquash/png',
      '@jsquash/webp',
      '@jsquash/resize',
    ])
  })
})
