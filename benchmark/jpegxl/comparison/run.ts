import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { cpus, platform, release, totalmem } from 'node:os'
import { type BrowserType, chromium, firefox, webkit } from '@playwright/test'
import type { execute, Job } from './execute.ts'
import { fixtures, hash, json, root, run, work } from './io.ts'
import { type Settings, subjects } from './model.ts'
import { validate } from './validate.ts'

const mode = process.argv[2] ?? 'smoke',
  runtime = process.argv[3] ?? 'node'
if (
  !['smoke', 'main', 'compat', 'cold', 'repair'].includes(mode) ||
  !['node', 'chromium', 'firefox', 'webkit'].includes(runtime)
)
  throw new Error('Usage: run.ts smoke|main|compat|cold node|chromium|firefox|webkit')
const selection = (process.env.JXL_COMPARE_SUBJECTS ?? subjects.join(',')).split(',')
const selected = subjects.filter((s) => selection.includes(s)),
  all = await fixtures(),
  selectedFixtures =
    mode === 'repair'
      ? all.filter((f) => f.sampleType === 'uint16')
      : mode === 'main'
        ? all
        : all.filter((f) =>
            ['im26-1030-diagnostic', 'alpha_triangles', 'rgb16-default'].includes(f.id),
          )
const out = `${work}/runs/${mode}-${runtime}`
await mkdir(out, { recursive: true })
const rows: unknown[] = [],
  started = new Date().toISOString()
let server: ReturnType<typeof createServer> | undefined,
  origin = ''
if (runtime !== 'node') {
  server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
      if (path === '/isolated') res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      if (path === '/plain' || path === '/isolated') {
        res.setHeader('Content-Type', 'text/html')
        res.end('<!doctype html><title>Manual JPEG XL comparison</title>')
        return
      }
      if (path === '/output' && req.method === 'POST') {
        const parts: Uint8Array[] = []
        let total = 0
        for await (const chunk of req) {
          if (!(chunk instanceof Uint8Array)) throw new Error('Invalid body')
          total += chunk.length
          if (total > 256 * 1024 * 1024) throw new Error('Output too large')
          parts.push(chunk)
        }
        await writeFile(`${out}/browser-output.bin`, Buffer.concat(parts))
        res.end('ok')
        return
      }
      if (path.includes('..')) throw new Error('Invalid path')
      const file = path.startsWith('/assets/')
        ? `${work}${path}`
        : path.startsWith('/web/')
          ? `${work}${path}`
          : path.startsWith('/fixtures/')
            ? `${work}${path}`
            : undefined
      if (!file) {
        res.statusCode = 404
        res.end()
        return
      }
      const bytes = await readFile(file)
      res.setHeader(
        'Content-Type',
        file.endsWith('.wasm')
          ? 'application/wasm'
          : file.endsWith('.js')
            ? 'text/javascript'
            : 'application/octet-stream',
      )
      res.setHeader('Content-Length', bytes.length)
      res.end(bytes)
    } catch (error) {
      res.statusCode = 500
      res.end(String(error))
    }
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server address')
  origin = `http://127.0.0.1:${address.port}`
}
const browserType: BrowserType =
  runtime === 'firefox' ? firefox : runtime === 'webkit' ? webkit : chromium
const browser = runtime === 'node' ? undefined : await browserType.launch({ headless: true })
const report = async () =>
  json(`${root}/results/${mode}-${runtime}.json`, {
    schemaVersion: 1,
    started,
    updated: new Date().toISOString(),
    mode,
    runtime,
    environment: {
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      hostMemoryBytes: totalmem(),
      node: process.version,
      browser: browser?.version() ?? null,
      browserMemory: 'unavailable: no consistent cross-browser measurement API',
      singleThread: true,
    },
    implementationRevision: run('git', ['rev-parse', 'HEAD']).trim(),
    subjectsSha256: hash(await readFile(`${root}/subjects.json`)),
    fixturesSha256: hash(await readFile(`${root}/fixtures.json`)),
    rows,
  })
try {
  for (const fixture of selectedFixtures)
    for (const subject of selected) {
      const settings: Settings = {
        lossless: true,
        effort: 1,
        value: subject === 'jsquash' ? 100 : 1,
      }
      const jobs: Job[] = [
        {
          subject,
          fixture,
          operation: 'decode-lossless',
          settings,
          repeats: mode === 'main' || mode === 'repair' ? 3 : mode === 'cold' ? 0 : 1,
        },
      ]
      if (mode === 'main' && fixture.lossy)
        jobs.push({ ...jobs[0], subject, fixture, operation: 'decode-lossy', settings, repeats: 3 })
      if (fixture.sampleType === 'uint8' || subject !== 'jsquash') {
        jobs.push({
          subject,
          fixture,
          operation: 'encode',
          settings,
          repeats: mode === 'main' || mode === 'repair' ? 3 : mode === 'cold' ? 0 : 1,
        })
        if (mode === 'main' && fixture.sampleType === 'uint8') {
          jobs.push({
            subject,
            fixture,
            operation: 'encode',
            settings: { lossless: false, effort: 1, value: subject === 'jsquash' ? 75 : 1 },
            repeats: 3,
          })
          // Bounded higher-effort subset; original 12 MP encoder timing remains effort 1.
          if (fixture.scope === 'capped')
            for (const lossless of [true, false])
              jobs.push({
                subject,
                fixture,
                operation: 'encode',
                settings: {
                  lossless,
                  effort: 7,
                  value: subject === 'jsquash' ? (lossless ? 100 : 75) : 1,
                },
                repeats: 3,
              })
          if (fixture.id === 'im26-1030-diagnostic')
            jobs.push({ subject, fixture, operation: 'roundtrip', settings, repeats: 3 })
        }
      } else jobs.push({ subject, fixture, operation: 'encode', settings, repeats: 1 })
      for (const [coldRepeat, job] of jobs.flatMap((job) =>
        Array.from({ length: mode === 'cold' ? 3 : 1 }, (_, index) => [index, job] as const),
      )) {
        const key = `${fixture.id}-${subject}-${job.operation}-${job.settings.lossless ? 'll' : 'ly'}-e${job.settings.effort}${mode === 'cold' ? `-cold${coldRepeat}` : ''}`,
          prefix = `${out}/${key}`
        console.log(`${runtime}: ${key}`)
        try {
          if (runtime === 'node') {
            await json(`${out}/job.json`, { ...job, output: prefix })
            const child = spawnSync(
              process.execPath,
              [`${root}/node-worker.ts`, `${out}/job.json`],
              { encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024 },
            )
            await writeFile(`${prefix}.log`, `${child.stdout ?? ''}\n${child.stderr ?? ''}`)
            if (child.status !== 0)
              throw new Error(
                `Node worker failed: ${child.error?.message ?? child.signal ?? child.status}; ${(child.stderr ?? '').slice(-1800)}`,
              )
          } else {
            if (!browser) throw new Error('Browser not started')
            const context = await browser.newContext(),
              page = await context.newPage(),
              requests: { url: string; bytes: number }[] = [],
              errors: string[] = []
            page.on('response', (response) => {
              const length = Number(response.headers()['content-length'] ?? 0)
              requests.push({ url: new URL(response.url()).pathname, bytes: length })
            })
            page.on('pageerror', (error) => errors.push(error.message))
            page.on('console', (message) => {
              if (message.type() === 'error') errors.push(message.text())
            })
            await page.goto(`${origin}/${subject === 'vips' ? 'isolated' : 'plain'}`)
            try {
              const result = await page.evaluate(async (job: Job) => {
                const load = async (path: string) =>
                  new Uint8Array(
                    await (await fetch(`/fixtures/${path.split('/').at(-1)}`)).arrayBuffer(),
                  )
                const input = await load(
                    job.operation === 'decode-lossy'
                      ? (job.fixture.lossy ?? job.fixture.lossless)
                      : job.fixture.lossless,
                  ),
                  raw = await load(job.fixture.raw)
                const pixels = {
                  width: job.fixture.width,
                  height: job.fixture.height,
                  channels: job.fixture.channels,
                  interpretation: job.fixture.sampleType === 'uint16' ? 'srgb16' : 'srgb',
                  data: job.fixture.sampleType === 'uint16' ? new Uint16Array(raw.buffer) : raw,
                }
                const worker = new Worker('/web/browser-worker.js', { type: 'module' })
                const result = await new Promise<Awaited<ReturnType<typeof execute>>>(
                  (resolve, reject) => {
                    const timer = setTimeout(() => {
                      worker.terminate()
                      reject(new Error('240 second worker deadline'))
                    }, 240000)
                    worker.onerror = (e) => {
                      clearTimeout(timer)
                      reject(new Error(e.message))
                    }
                    worker.onmessage = (e) => {
                      clearTimeout(timer)
                      resolve(e.data)
                    }
                    worker.postMessage({ job, input, pixels })
                  },
                )
                worker.terminate()
                const { output, ...measurement } = result
                let descriptor: unknown = null
                if (output) {
                  const bytes =
                    output.kind === 'pixels'
                      ? new Uint8Array(
                          output.pixels.data.buffer,
                          output.pixels.data.byteOffset,
                          output.pixels.data.byteLength,
                        )
                      : output.bytes
                  const copy = new Uint8Array(bytes)
                  const digest = Array.from(
                    new Uint8Array(await crypto.subtle.digest('SHA-256', copy)),
                  )
                    .map((v) => v.toString(16).padStart(2, '0'))
                    .join('')
                  await fetch('/output', { method: 'POST', body: copy })
                  descriptor =
                    output.kind === 'pixels'
                      ? {
                          ...output.pixels,
                          data: undefined,
                          sampleType:
                            output.pixels.data instanceof Uint16Array
                              ? 'uint16'
                              : output.pixels.data instanceof Float32Array
                                ? 'float32'
                                : 'uint8',
                          kind: output.kind,
                          sha256: digest,
                          bytes: bytes.length,
                        }
                      : { kind: output.kind, sha256: digest, bytes: bytes.length }
                }
                return {
                  ...measurement,
                  output: descriptor,
                  crossOriginIsolated,
                  hardwareConcurrency: navigator.hardwareConcurrency,
                }
              }, job)
              if (result.output)
                await writeFile(`${prefix}.bin`, await readFile(`${out}/browser-output.bin`))
              await json(`${prefix}.json`, { ...result, requests, errors, memory: null })
            } finally {
              await context.close()
            }
          }
          const measurement = await validate(
            prefix,
            fixture,
            job.operation,
            job.settings.lossless,
            job.subject,
          )
          rows.push({
            key,
            subject,
            fixture: fixture.id,
            scope: fixture.scope,
            category: fixture.category,
            operation: job.operation,
            settings: job.settings,
            workflow:
              subject === 'oxide'
                ? 'decode + mandatory PNG export'
                : 'materialized pixels (decode expands gray/RGB to RGBA8) or encoded bytes',
            artifact: `${prefix}.bin`,
            ...measurement,
          })
        } catch (error) {
          rows.push({
            key,
            subject,
            fixture: fixture.id,
            scope: fixture.scope,
            operation: job.operation,
            settings: job.settings,
            status: 'execution failure',
            detail: String(error),
          })
        }
        await report()
      }
    }
} finally {
  await browser?.close()
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve())
    else resolve()
  })
  await report()
}
