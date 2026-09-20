import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isJpegXlWorkbenchRequest,
  planJpegXlWorkbenchNativeMemory,
} from '../../docs-astro/src/scripts/jpegxl-workbench-types.ts'
import type { PixelColorSemantics } from '../../src/color.ts'
import { inspectJpegXlStructure, jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { openJpegXlSequence } from '../../src/codecs/jpegxl-sequence.ts'
import { encodeJpegXlAnimation } from '../../src/codecs/jpegxl-sequence-encode.ts'
import { openJpegXlSession } from '../../src/codecs/jpegxl-session.ts'
import { ImageError } from '../../src/errors.ts'
import { createEvidenceSession } from '../../src/evidence.ts'
import {
  inspectJpegXl,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { type ImageSink, Uint8ArraySink } from '../../src/sink.ts'
import type { ImageSource } from '../../src/source.ts'
import { MemorySource } from '../../src/source.ts'
import {
  m9ExpectedResourceOutcomes,
  m9OwnershipMeasuredResourceCases,
  validateM9FuzzResourceReport,
} from './m9-evidence-validation.ts'
import gateManifest from './production-program/m9-gate-manifest.json' with { type: 'json' }
import securitySources from './production-program/m9-security-sources.json' with { type: 'json' }

type Outcome = 'passed' | 'malformed' | 'unsupported' | 'limit-exceeded' | 'cancelled'
interface M9SafetyCase {
  readonly id: string
  readonly outcome: Outcome
  readonly rawException: false
  readonly managedLiveBytes: number | null
  readonly elapsedMilliseconds: number
  readonly inputSha256: string
  readonly code?: string
}

const hash = (value: Uint8Array | string): string =>
  createHash('sha256').update(value).digest('hex')
const now = (): number => performance.now()
const fixture = (path: string): Promise<Uint8Array> => readFile(path)
const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}
const fragmentBox = (index: number, final: boolean, payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(12 + payload.byteLength)
  const view = new DataView(output.buffer)
  view.setUint32(0, output.byteLength)
  output.set(new TextEncoder().encode('jxlp'), 4)
  view.setUint32(8, index | (final ? 0x8000_0000 : 0))
  output.set(payload, 12)
  return output
}
const splitContainerCodestream = async (input: Uint8Array): Promise<Uint8Array> => {
  const structure = await inspectJpegXlStructure(input)
  const containerBox = structure.boxes.find(({ type }) => type === 'jxlc')
  const segment = structure.codestreamSegments[0]
  if (!containerBox || !segment) throw new Error('M9 fragmented fixture is not a jxlc container')
  const codestream = input.subarray(segment.offset, segment.offset + segment.length)
  const split = Math.max(1, Math.floor(codestream.byteLength / 2))
  return concatenate(
    input.subarray(0, containerBox.offset),
    fragmentBox(0, false, codestream.subarray(0, split)),
    fragmentBox(1, true, codestream.subarray(split)),
  )
}
interface M9SafetyResult {
  readonly outcome: Outcome
  readonly managedLiveBytes: number | null
  readonly code?: string
}
const classify = (error: unknown): M9SafetyResult => {
  if (error instanceof ImageError) {
    if (error.code === 'LIMIT_EXCEEDED')
      return { outcome: 'limit-exceeded', code: error.code, managedLiveBytes: null }
    if (error.code === 'UNSUPPORTED_OPERATION')
      return { outcome: 'unsupported', code: error.code, managedLiveBytes: null }
    return { outcome: 'malformed', code: error.code, managedLiveBytes: null }
  }
  if (error instanceof Error && error.name === 'AbortError')
    return { outcome: 'cancelled', code: 'ABORT_ERR', managedLiveBytes: null }
  throw error
}
const row = (
  id: string,
  input: Uint8Array,
  started: number,
  result: Readonly<M9SafetyResult>,
): M9SafetyCase =>
  Object.freeze({
    id,
    outcome: result.outcome,
    rawException: false,
    managedLiveBytes: result.managedLiveBytes,
    elapsedMilliseconds: Math.max(0, performance.now() - started),
    inputSha256: hash(input),
    ...(result.code ? { code: result.code } : {}),
  })

const decodeMutation = async (id: string, path: string, divisor: number): Promise<M9SafetyCase> => {
  const input = Uint8Array.from(await fixture(path))
  const offset = Math.max(2, Math.min(input.length - 1, Math.floor(input.length / divisor)))
  input[offset] = (input[offset] ?? 0) ^ (1 << (divisor % 8))
  const started = now()
  try {
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), {
      ...defaultImageLimits,
      maxPixels: 16_777_216,
      maxDecodedBytes: 268_435_456,
    })
    if (!decoder) throw new Error('JPEG XL decoder unavailable')
    for await (const block of decoder.decode()) block.release?.()
    return row(id, input, started, { outcome: 'passed', managedLiveBytes: null })
  } catch (error) {
    return row(id, input, started, classify(error))
  }
}

const targetedMutation = async (
  id: string,
  seed: Uint8Array,
  divisor: number,
  operation: (input: Uint8Array) => Promise<void>,
): Promise<M9SafetyCase> => {
  try {
    await operation(seed)
  } catch (cause) {
    throw new Error(`M9 ${id} unmutated seed did not reach its target subsystem`, { cause })
  }
  const input = seed.slice()
  const offset = Math.max(2, Math.min(input.length - 1, Math.floor(input.length / divisor)))
  input[offset] = (input[offset] ?? 0) ^ (1 << (divisor % 8))
  const started = now()
  try {
    await operation(input)
    return row(id, input, started, { outcome: 'passed', managedLiveBytes: null })
  } catch (error) {
    return row(id, input, started, classify(error))
  }
}

const exerciseAnimation = async (input: Uint8Array): Promise<void> => {
  const sequence = await openJpegXlSequence(input)
  let frames = 0,
    sawTiming = false,
    sawBlend = false
  try {
    for await (const frame of sequence.frames()) {
      frames++
      sawTiming ||= frame.durationTicks > 0 && BigInt(frame.startTicks) >= 0n
      sawBlend ||= frame.header.blending?.mode === 2
    }
  } finally {
    await sequence.close()
  }
  if (frames < 2 || !sawTiming || !sawBlend)
    throw new Error('M9 animation seed did not exercise timing and reference blending')
}

const exerciseReconstruction = async (input: Uint8Array): Promise<void> => {
  const jpeg = await reconstructJpegFromJpegXl(input)
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9)
    throw new Error('M9 exact reconstruction did not emit a JPEG')
}

const writerWidth = 17,
  writerHeight = 9
const writerSeed = new Uint8Array(writerWidth * writerHeight * 3)
for (let index = 0; index < writerSeed.length; index++) writerSeed[index] = (index * 29 + 17) & 255
const writerSemantics: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'assumed-default',
  renderingIntent: 'relative',
}
const exerciseWriters = async (input: Uint8Array): Promise<void> => {
  if (input.length !== writerSeed.length) throw new Error('M9 writer seed extent changed')
  for (const mode of ['lossless', 'lossy'] as const) {
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: writerWidth,
      height: writerHeight,
      pixelFormat: 'rgb8',
      colorSemantics: writerSemantics,
      options: mode === 'lossless' ? { mode, effort: 1 } : { mode, effort: 1, distance: 1 },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error(`M9 ${mode} writer is unavailable`)
    await encoder.write({
      x: 0,
      y: 0,
      width: writerWidth,
      height: writerHeight,
      stride: writerWidth * 3,
      format: 'rgb8',
      data: input,
    })
    await encoder.finish()
    const inspection = await inspectJpegXl(sink.toUint8Array())
    if (inspection.width !== writerWidth || inspection.height !== writerHeight)
      throw new Error(`M9 ${mode} writer output extent changed`)
  }
}

const fuzzPaths: Readonly<Record<string, readonly [string, number]>> = {
  'boxes-level-segments-metadata': ['tests/fixtures/jpegxl/m5-pipeline/segmented.jxl', 19],
  'entropy-prefix-ans-lz77': ['tests/fixtures/jpegxl/m7-effort1-context-map/image.jxl', 3],
  'ma-tree-palette-squeeze': [
    'tests/fixtures/jpegxl/m8-palette-squeeze/grayscale-public-university.jxl',
    5,
  ],
  'coefficients-transforms-filters': [
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-strategy-mix.jxl',
    4,
  ],
  'patches-splines-noise': ['tests/fixtures/jpegxl/m8-static/weighted-patches.jxl', 7],
  'progressive-dependencies': [
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
    11,
  ],
  'icc-extra-channels': ['tests/fixtures/jpegxl/m4-color/vardct-alpha-0-2.jxl', 17],
  'native-display-conversion': ['tests/fixtures/jpegxl/m4-color/vardct-pq-16.jxl', 31],
}

const runFuzzCases = async (): Promise<readonly M9SafetyCase[]> => {
  const cases: M9SafetyCase[] = []
  for (const id of gateManifest.fuzzTargets) {
    if (id === 'api-limits-worker-messages') {
      const input = new TextEncoder().encode('hostile worker request')
      const started = now()
      const accepted = isJpegXlWorkbenchRequest({
        type: 'open',
        requestId: -1,
        generation: Number.NaN,
        name: 'hostile.jxl',
        bytes: new ArrayBuffer(0),
      })
      let bounded = false
      try {
        planJpegXlWorkbenchNativeMemory(2 ** 30, 2 ** 30, 'rgba16')
      } catch (error) {
        bounded = error instanceof Error && error.message.includes('before pixel allocation')
      }
      if (accepted || !bounded) throw new Error('M9 worker or API limit validation failed')
      cases.push(
        row(id, input, started, {
          outcome: 'limit-exceeded',
          code: 'LIMIT_EXCEEDED',
          managedLiveBytes: null,
        }),
      )
      continue
    }
    if (id === 'animation-reference-timing-blend') {
      cases.push(
        await targetedMutation(
          id,
          await fixture('tests/fixtures/jpegxl/m8-sequence/newtons-cradle.jxl'),
          13,
          exerciseAnimation,
        ),
      )
      continue
    }
    if (id === 'exact-jpeg-reconstruction') {
      cases.push(
        await targetedMutation(
          id,
          await fixture(
            'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/progressive-rgb-exif.jxl',
          ),
          23,
          exerciseReconstruction,
        ),
      )
      continue
    }
    if (id === 'lossless-lossy-writers') {
      cases.push(await targetedMutation(id, writerSeed, 29, exerciseWriters))
      continue
    }
    const configured = fuzzPaths[id]
    if (!configured) throw new Error(`Missing M9 fuzz target ${id}`)
    cases.push(await decodeMutation(id, configured[0], configured[1]))
  }
  return Object.freeze(cases)
}

const resourceCase = async (
  id: string,
  input: Uint8Array,
  operation: () => Promise<Readonly<M9SafetyResult>>,
): Promise<M9SafetyCase> => {
  const started = now()
  try {
    return row(id, input, started, await operation())
  } catch (error) {
    return row(id, input, started, classify(error))
  }
}

const runResourceCases = async (): Promise<readonly M9SafetyCase[]> => {
  const progressive = await fixture(
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
  )
  const animation = await fixture('tests/fixtures/jpegxl/m8-sequence/newtons-cradle.jxl')
  const fragmented = await fixture('tests/fixtures/jpegxl/m9-hardening/rgb8-jxlc.jxl')
  const fragmentedLimit = await splitContainerCodestream(fragmented)
  const jpeg = await fixture('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg')
  const cases: M9SafetyCase[] = []

  cases.push(
    await resourceCase('zero-progress-source', progressive, async () => {
      const source: ImageSource = {
        size: progressive.length,
        async read() {
          return new Uint8Array()
        },
      }
      await inspectJpegXl(source)
      return { outcome: 'passed', managedLiveBytes: null }
    }),
  )
  cases.push(
    await resourceCase('section-count-limit', fragmentedLimit, async () => {
      await inspectJpegXl(fragmentedLimit, { limits: { maxSegments: 1 } })
      return { outcome: 'passed', managedLiveBytes: null }
    }),
  )
  cases.push(
    await resourceCase('internal-frame-limit', animation, async () => {
      const sequence = await openJpegXlSequence(animation, { limits: { maxInternalFrames: 1 } })
      try {
        for await (const _header of sequence.headers()) {
          // Iteration is the bounded operation.
        }
      } finally {
        await sequence.close()
      }
      return { outcome: 'passed', managedLiveBytes: null }
    }),
  )
  cases.push(
    await resourceCase('declared-pixel-limit', progressive, async () => {
      await jpegxlCodec.createDecoder?.(new MemorySource(progressive), {
        ...defaultImageLimits,
        maxPixels: 1,
      })
      return { outcome: 'passed', managedLiveBytes: null }
    }),
  )
  cases.push(
    await resourceCase('metadata-limit', animation, async () => {
      await inspectJpegXl(animation, { limits: { maxHeaderBytes: 16 } })
      return { outcome: 'passed', managedLiveBytes: null }
    }),
  )
  cases.push(
    await resourceCase('computation-cancellation', progressive, async () => {
      const evidence = createEvidenceSession({ mode: 'trace' })
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      evidence.subscribe((event) => {
        if (event.type === 'allocation' && event.category.includes('restoration'))
          timer ??= setTimeout(() => controller.abort(), 0)
      })
      const session = await openJpegXlSession(progressive, { evidence: evidence.context })
      let cancelled = false
      try {
        try {
          for await (const event of session.native({
            scaleDenominator: 8,
            signal: controller.signal,
          }))
            if (event.type === 'block') event.block.release?.()
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'AbortError') throw error
          cancelled = true
        }
      } finally {
        if (timer) clearTimeout(timer)
        await session.close()
      }
      if (!controller.signal.aborted || !cancelled)
        throw new Error('M9 computation did not observe cancellation')
      if (session.managedLiveBytes !== 0)
        throw new Error('M9 computation cancellation leaked memory')
      return {
        outcome: 'cancelled',
        code: 'ABORT_ERR',
        managedLiveBytes: session.managedLiveBytes,
      }
    }),
  )
  cases.push(
    await resourceCase('fetch-cancellation', progressive, async () => {
      const controller = new AbortController()
      let suspendReads = false
      const source: ImageSource = {
        size: progressive.length,
        async read(offset, length, options) {
          if (suspendReads) {
            await new Promise<void>((_resolve, reject) => {
              const rejectAbort = () => reject(new DOMException('Cancelled', 'AbortError'))
              if (options?.signal?.aborted) rejectAbort()
              else options?.signal?.addEventListener('abort', rejectAbort, { once: true })
            })
          }
          return progressive.subarray(offset, Math.min(offset + length, progressive.length))
        },
      }
      const session = await openJpegXlSession(source)
      const iterator = session.native({ scaleDenominator: 8, signal: controller.signal })
      await iterator.next()
      suspendReads = true
      const pending = iterator.next()
      controller.abort()
      try {
        await pending
        throw new Error('M9 fetch cancellation was ignored')
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'AbortError') throw error
      } finally {
        await session.close()
      }
      if (session.managedLiveBytes !== 0) throw new Error('M9 fetch cancellation leaked memory')
      return {
        outcome: 'cancelled',
        code: 'ABORT_ERR',
        managedLiveBytes: session.managedLiveBytes,
      }
    }),
  )
  cases.push(
    await resourceCase('sink-failure', jpeg, async () => {
      let aborted = false
      const sink: ImageSink = {
        async write() {
          throw new Error('M9 injected sink failure')
        },
        async close() {
          throw new Error('M9 sink unexpectedly closed')
        },
        async abort() {
          aborted = true
        },
      }
      try {
        await transcodeJpegToJpegXl(jpeg, { sink })
      } catch (error) {
        if (!aborted || !(error instanceof Error) || !error.message.includes('injected sink'))
          throw error
        return { outcome: 'passed', managedLiveBytes: null }
      }
      throw new Error('M9 sink failure was ignored')
    }),
  )
  cases.push(
    await resourceCase('pending-write-abort', jpeg, async () => {
      const controller = new AbortController()
      let aborted = false,
        closeCalls = 0,
        markWriteStarted: (() => void) | undefined,
        releaseWrite: (() => void) | undefined
      const writeStarted = new Promise<void>((resolve) => {
        markWriteStarted = resolve
      })
      const pendingWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      const sink: ImageSink = {
        write() {
          markWriteStarted?.()
          return pendingWrite
        },
        async close() {
          closeCalls++
        },
        async abort() {
          aborted = true
          releaseWrite?.()
        },
      }
      const transcode = transcodeJpegToJpegXl(jpeg, { sink, signal: controller.signal })
      await writeStarted
      controller.abort()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          transcode,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('M9 pending write did not cancel within 500ms')),
              500,
            )
          }),
        ])
      } catch (error) {
        if (timeout) clearTimeout(timeout)
        if (
          !aborted ||
          closeCalls !== 0 ||
          !(error instanceof Error) ||
          error.name !== 'AbortError'
        )
          throw error
        return { outcome: 'cancelled', code: 'ABORT_ERR', managedLiveBytes: null }
      } finally {
        releaseWrite?.()
      }
      throw new Error('M9 pending write abort was ignored')
    }),
  )
  cases.push(
    await resourceCase('early-consumer-return', animation, async () => {
      let returned = false
      async function* frames() {
        try {
          for (let index = 0; index < 5; index++)
            yield { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4), durationTicks: 1 }
        } finally {
          returned = true
        }
      }
      const iterator = encodeJpegXlAnimation(frames(), {
        width: 8,
        height: 8,
        pixelFormat: 'rgba8',
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: 'straight',
          provenance: 'container-signaled',
          renderingIntent: 'relative',
        },
        animation: {
          ticksPerSecondNumerator: 1,
          ticksPerSecondDenominator: 1,
          loops: 0,
          haveTimecodes: false,
        },
      })
      await iterator.next()
      await iterator.return(undefined)
      if (!returned) throw new Error('M9 animation input was not returned')
      return { outcome: 'passed', managedLiveBytes: null }
    }),
  )
  cases.push(
    await resourceCase('resource-reuse', progressive, async () => {
      const session = await openJpegXlSession(progressive, { maxCachedBytes: 0 })
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          for await (const event of session.native({ scaleDenominator: 8 }))
            if (event.type === 'block') event.block.release?.()
          if (session.managedLiveBytes !== 0) throw new Error('M9 reused session retained memory')
        }
      } finally {
        await session.close()
      }
      return { outcome: 'passed', managedLiveBytes: session.managedLiveBytes }
    }),
  )
  cases.push(
    await resourceCase('malformed-after-preview', progressive, async () => {
      const frames = await readJpegXlSourceFrameStructures(
        new MemorySource(progressive),
        defaultImageLimits,
      )
      const failing = frames.at(-1)?.sections.at(-1)
      if (!failing) throw new Error('M9 progressive fixture has no final section')
      const source: ImageSource = {
        size: progressive.length,
        async read(offset, length) {
          if (offset === failing.offset && length === failing.length)
            throw new ImageError('TRUNCATED_INPUT', 'M9 injected late section failure')
          return progressive.subarray(offset, offset + length)
        },
      }
      const session = await openJpegXlSession(source)
      let completed = 0
      try {
        try {
          for await (const event of session.progressive()) {
            if (event.type === 'block') event.block.release?.()
            if (event.type === 'stage-complete') completed++
          }
          throw new Error('M9 injected late section failure was ignored')
        } catch (error) {
          if (!(error instanceof ImageError) || error.code !== 'TRUNCATED_INPUT') throw error
        }
      } finally {
        await session.close()
      }
      if (completed < 1) throw new Error('M9 late failure occurred before a partial preview')
      if (session.managedLiveBytes !== 0) throw new Error('M9 late failure leaked memory')
      return {
        outcome: 'malformed',
        code: 'TRUNCATED_INPUT',
        managedLiveBytes: session.managedLiveBytes,
      }
    }),
  )
  return Object.freeze(cases)
}

export const runM9FuzzResource = async () => {
  const fuzzCases = await runFuzzCases()
  const resourceCases = await runResourceCases()
  const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
  const statusResult = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  const revision = revisionResult.stdout.trim()
  if (revisionResult.status !== 0 || !/^[0-9a-f]{40}$/u.test(revision))
    throw new Error('Cannot resolve M9 fuzz/resource revision')
  if (statusResult.status !== 0) throw new Error('Cannot inspect M9 fuzz/resource worktree')
  const securityReview = securitySources.sources.map(({ id, url }) => ({ id, url, reviewed: true }))
  const allCases = [...fuzzCases, ...resourceCases]
  const rawExceptions = allCases.filter(({ rawException }) => rawException).length
  const leakedOwnership = allCases.filter(
    ({ managedLiveBytes }) => typeof managedLiveBytes === 'number' && managedLiveBytes !== 0,
  ).length
  const expectedOutcomes = resourceCases.every(
    ({ id, outcome }) => m9ExpectedResourceOutcomes[id] === outcome,
  )
  const ownershipMeasured = resourceCases.every(
    ({ id, managedLiveBytes }) =>
      !m9OwnershipMeasuredResourceCases.has(id) || typeof managedLiveBytes === 'number',
  )
  return {
    schemaVersion: 1,
    revision,
    clean: statusResult.stdout.trim() === '',
    manifestSha256: hash(
      await readFile('benchmark/jpegxl/production-program/m9-gate-manifest.json'),
    ),
    securitySources: securityReview,
    fuzzCases,
    resourceCases,
    summary: {
      passed: rawExceptions === 0 && leakedOwnership === 0 && expectedOutcomes && ownershipMeasured,
      total: allCases.length,
      rawExceptions,
      leakedOwnership,
    },
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const outputIndex = process.argv.indexOf('--output')
  const report = await runM9FuzzResource()
  validateM9FuzzResourceReport(report, report.revision)
  const json = `${JSON.stringify(report, null, 2)}\n`
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  if (outputPath) await writeFile(outputPath, json)
  else process.stdout.write(json)
}
