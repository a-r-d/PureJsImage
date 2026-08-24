import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, relative, resolve } from 'node:path'
import { build } from 'esbuild'

import { generatedScientificFixtures } from '../scientific-readers/generated-fixtures.ts'
import type { ViewerLatencyProfile, ViewerServerRequestLog } from './types.ts'

const port = Number(process.env.PUREJSIMAGE_VIEWER_PORT ?? '4174')
const outputDirectory = resolve('benchmark/viewers/.tmp')
const itkPipelineDirectory = resolve(
  'benchmark/viewers/node_modules/@itk-wasm/image-io/dist/pipelines',
)

interface ViewerFixture {
  readonly id: string
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly exact: boolean
  readonly note: string
}

interface MutableRequestLog {
  readonly id: number
  readonly method: string
  readonly pathname: string
  readonly fixtureId: string | null
  readonly rangeStart: number | null
  readonly rangeEnd: number | null
  readonly requestedBytes: number
  returnedBytes: number
  readonly cacheMode: ViewerServerRequestLog['cacheMode']
  readonly latencyMilliseconds: number
  readonly throughputBytesPerSecond: number | null
  aborted: boolean
}

const contentTypes: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zst': 'application/octet-stream',
})

const fixtureBytes = (key: keyof typeof generatedScientificFixtures): Uint8Array => {
  const fixture = generatedScientificFixtures[key]?.()
  const resource = fixture?.resources[0]
  if (resource === undefined) throw new Error(`Generated viewer fixture ${key} is empty`)
  return resource.bytes
}

const viewerNifti = (): Uint8Array => {
  const width = 512
  const height = 512
  const depth = 128
  const dataOffset = 352
  const voxelCount = width * height * depth
  const output = new Uint8Array(dataOffset + voxelCount * 2)
  const view = new DataView(output.buffer)
  view.setInt32(0, 348, true)
  view.setInt16(40, 3, true)
  view.setInt16(42, width, true)
  view.setInt16(44, height, true)
  view.setInt16(46, depth, true)
  view.setInt16(48, 1, true)
  view.setInt16(70, 4, true)
  view.setInt16(72, 16, true)
  view.setFloat32(76, 1, true)
  view.setFloat32(80, 1, true)
  view.setFloat32(84, 1, true)
  view.setFloat32(88, 1, true)
  view.setFloat32(108, dataOffset, true)
  view.setFloat32(112, 1, true)
  view.setFloat32(116, 0, true)
  output[123] = 2
  output.set(new TextEncoder().encode('viewer volume'), 148)
  output.set([0x6e, 0x2b, 0x31, 0, 0, 0, 0, 0], 344)
  view.setInt16(dataOffset, 1, true)
  view.setInt16(output.byteLength - 2, 2, true)
  return output
}

const fixtures: Readonly<Record<string, ViewerFixture>> = Object.freeze({
  'ome-tiff': Object.freeze({
    id: 'ome-tiff',
    bytes: fixtureBytes('ome-tiff-viewer-generated'),
    contentType: 'image/tiff',
    exact: true,
    note: 'Generated 4096x4096 two-channel tiled OME-TIFF (32 MiB pixel payload).',
  }),
  nifti: Object.freeze({
    id: 'nifti-volume',
    bytes: viewerNifti(),
    contentType: 'application/octet-stream',
    exact: true,
    note: 'Viewer-only generated NIfTI-1 512x512x128 volume (64 MiB payload) shared by volume engines.',
  }),
  nrrd: Object.freeze({
    id: 'nrrd-volume',
    bytes: fixtureBytes('nrrd-raw-generated'),
    contentType: 'application/octet-stream',
    exact: true,
    note: 'Generated raw NRRD volume.',
  }),
  meta: Object.freeze({
    id: 'meta-volume',
    bytes: fixtureBytes('mha-generated'),
    contentType: 'application/octet-stream',
    exact: true,
    note: 'Generated detached/in-line MetaImage-compatible fixture.',
  }),
  cog: Object.freeze({
    id: 'cog',
    bytes: fixtureBytes('cog-viewer-generated'),
    contentType: 'image/tiff',
    exact: true,
    note: 'Generated 8192x8192 tiled GeoTIFF with metadata and tile tables before pixel payload.',
  }),
})

const logs: MutableRequestLog[] = []
let nextLogId = 1
const maximumSleepMilliseconds = 60_000

const writeJson = (response: ServerResponse, value: unknown): void => {
  const body = JSON.stringify(value)
  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

const sleep = async (milliseconds: number): Promise<void> => {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return
  if (milliseconds > maximumSleepMilliseconds) {
    throw new Error(`Requested delay exceeds ${maximumSleepMilliseconds} milliseconds`)
  }
  await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

const parseLatency = (value: string | null): ViewerLatencyProfile => {
  const latency = Number(value ?? '0')
  if (latency !== 0 && latency !== 5 && latency !== 25 && latency !== 100) {
    throw new Error(`latencyMs must be one of 0, 5, 25, or 100; received ${value ?? '0'}`)
  }
  return latency
}

const parseCacheMode = (value: string | null): ViewerServerRequestLog['cacheMode'] => {
  if (value === null || value === 'no-store') return 'no-store'
  if (value === 'revalidate' || value === 'immutable') return value
  throw new Error(`cacheMode must be no-store, revalidate, or immutable; received ${value}`)
}

const parseThroughput = (value: string | null): number | null => {
  if (value === null || value.length === 0) return null
  const throughput = Number(value)
  if (!Number.isFinite(throughput) || throughput <= 0) {
    throw new Error(`throughputBytesPerSecond must be positive; received ${value}`)
  }
  return throughput
}

const rangeFromRequest = (
  request: IncomingMessage,
  length: number,
): readonly [number, number] | undefined => {
  const raw = request.headers.range
  if (raw === undefined) return undefined
  const match = /^bytes=(\d+)-(\d*)$/u.exec(raw)
  if (match === null) throw new Error(`Unsupported Range header ${raw}`)
  const start = Number(match[1])
  const requestedEnd = match[2] === '' ? length - 1 : Number(match[2])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= length
  ) {
    throw new Error(`Range ${raw} is outside a ${length}-byte fixture`)
  }
  return [start, Math.min(requestedEnd, length - 1)]
}

const fixtureForPath = (pathname: string): ViewerFixture | undefined => {
  const name = pathname.slice('/data/'.length)
  const fixture = fixtures[name]
  if (fixture === undefined) return undefined
  return fixture
}

const responseHeaders = (
  fixture: ViewerFixture,
  bodyLength: number,
  cacheMode: ViewerServerRequestLog['cacheMode'],
): Record<string, string | number> => ({
  'accept-ranges': 'bytes',
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Content-Range, ETag, Last-Modified',
  'cache-control':
    cacheMode === 'immutable'
      ? 'public, max-age=31536000, immutable'
      : cacheMode === 'revalidate'
        ? 'no-cache'
        : 'no-store',
  'content-length': bodyLength,
  'content-type': fixture.contentType,
  etag: '"purejsimage-viewer-fixture-v1"',
})

const serveFixture = async (
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  fixture: ViewerFixture,
): Promise<void> => {
  const latencyMilliseconds = parseLatency(requestUrl.searchParams.get('latencyMs'))
  const cacheMode = parseCacheMode(requestUrl.searchParams.get('cacheMode'))
  const throughputBytesPerSecond = parseThroughput(
    requestUrl.searchParams.get('throughputBytesPerSecond'),
  )
  const range = rangeFromRequest(request, fixture.bytes.byteLength)
  const start = range?.[0] ?? 0
  const end = range?.[1] ?? fixture.bytes.byteLength - 1
  const body = fixture.bytes.subarray(start, end + 1)
  const log: MutableRequestLog = {
    id: nextLogId,
    method: request.method ?? 'GET',
    pathname: requestUrl.pathname,
    fixtureId: fixture.id,
    rangeStart: range?.[0] ?? null,
    rangeEnd: range?.[1] ?? null,
    requestedBytes: body.byteLength,
    returnedBytes: 0,
    cacheMode,
    latencyMilliseconds,
    throughputBytesPerSecond,
    aborted: false,
  }
  nextLogId += 1
  logs.push(log)
  let completed = false
  response.on('close', () => {
    if (!completed) log.aborted = true
  })
  await sleep(latencyMilliseconds)
  if (throughputBytesPerSecond !== null) {
    await sleep((body.byteLength / throughputBytesPerSecond) * 1_000)
  }
  if (response.destroyed) return
  const headers = responseHeaders(fixture, body.byteLength, cacheMode)
  if (range !== undefined) {
    response.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${fixture.bytes.byteLength}`,
    })
  } else {
    response.writeHead(200, headers)
  }
  response.end(body, () => {
    completed = true
    log.returnedBytes = body.byteLength
  })
}

const safeStaticPath = (base: string, pathname: string): string => {
  const candidate = resolve(base, `.${decodeURIComponent(pathname)}`)
  const escaped = relative(base, candidate)
  if (escaped.startsWith('..') || escaped.includes('/../'))
    throw new Error('Path escapes server root')
  return candidate
}

const html = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>PureJsImage scientific viewer benchmark</title></head>
<body><main><canvas id="viewer-canvas" width="256" height="192"></canvas><div id="viewer-mount"></div></main>
<script type="module" src="/viewer-harness.js"></script></body></html>`

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (requestUrl.pathname === '/__viewer/manifest') {
      writeJson(response, {
        schemaVersion: 1,
        fixtures: Object.fromEntries(
          Object.entries(fixtures).map(([key, fixture]) => [
            key,
            {
              id: fixture.id,
              bytes: fixture.bytes.byteLength,
              exact: fixture.exact,
              note: fixture.note,
            },
          ]),
        ),
        latencyProfiles: [0, 5, 25, 100],
        indexedOmeTiff: { sidecarGenerationOutsideTiming: true },
      })
      return
    }
    if (requestUrl.pathname === '/__viewer/reset') {
      logs.splice(0, logs.length)
      nextLogId = 1
      writeJson(response, { ok: true })
      return
    }
    if (requestUrl.pathname === '/__viewer/requests') {
      writeJson(response, logs)
      return
    }
    if (requestUrl.pathname === '/__viewer/health') {
      writeJson(response, { ok: true })
      return
    }
    if (requestUrl.pathname.startsWith('/data/')) {
      const fixture = fixtureForPath(requestUrl.pathname)
      if (fixture === undefined) {
        response.writeHead(404).end('Unknown viewer fixture')
        return
      }
      await serveFixture(request, response, requestUrl, fixture)
      return
    }
    if (requestUrl.pathname.startsWith('/itk-pipelines/')) {
      const path = safeStaticPath(
        itkPipelineDirectory,
        requestUrl.pathname.slice('/itk-pipelines'.length),
      )
      const data = await readFile(path)
      const type = contentTypes[extname(path)] ?? 'application/octet-stream'
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': data.byteLength,
        'content-type': type,
      })
      response.end(data)
      return
    }
    if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
      const body = html()
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      })
      response.end(body)
      return
    }
    const path = safeStaticPath(outputDirectory, requestUrl.pathname)
    const data = await readFile(path)
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': data.byteLength,
      'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
    })
    response.end(data)
  } catch (cause) {
    if (response.headersSent) {
      response.destroy()
      return
    }
    const message = cause instanceof Error ? cause.message : 'Unknown viewer server error'
    response.writeHead(message.includes('Range') ? 416 : 404).end(message)
  }
})

await build({
  absWorkingDir: process.cwd(),
  alias: {
    url: resolve('benchmark/viewers/browser-shims/url.ts'),
  },
  bundle: true,
  entryPoints: ['benchmark/viewers/browser-harness.ts'],
  format: 'esm',
  legalComments: 'none',
  logLevel: 'info',
  minify: false,
  outdir: outputDirectory,
  platform: 'browser',
  splitting: true,
  sourcemap: false,
  target: ['es2022'],
  chunkNames: 'viewer-chunk-[hash]',
  entryNames: 'viewer-harness',
})

server.listen(port, '127.0.0.1', () => {
  console.log(`PureJsImage viewer benchmark server listening on http://127.0.0.1:${port}`)
})
