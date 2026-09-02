import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { geoShowcaseSourceAliases } from './geo-showcase-build.ts'
import { geoShowcaseZarrResources } from './geo-showcase-fixtures.ts'
import { jpegXlWorkbenchPng } from '../benchmark/jpegxl/workbench-fixture.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const featureTourPrefix = '/fixtures/ome-zarr-feature-tour/'
const geoFixturePrefix = '/fixtures/geo/'

const scriptEntries: Readonly<Record<string, string>> = {
  '/assets/demo-app.js': 'docs-astro/src/scripts/demo.ts',
  '/assets/wsi-viewer.js': 'docs-astro/src/scripts/wsi-viewer.ts',
  '/assets/wsi-worker.js': 'docs-astro/src/scripts/wsi-worker.ts',
  '/assets/ome-zarr-viewer.js': 'docs-astro/src/scripts/ome-zarr-viewer.ts',
  '/assets/ome-zarr-worker.js': 'docs-astro/src/scripts/ome-zarr-worker.ts',
  '/assets/geo-showcase.js': 'docs-astro/src/scripts/geo-showcase.ts',
  '/assets/geo-showcase-worker.js': 'docs-astro/src/scripts/geo-showcase-worker.ts',
  '/assets/hdr-surgery.js': 'docs-astro/src/scripts/hdr-surgery.ts',
  '/assets/hdr-surgery-worker.js': 'docs-astro/src/scripts/hdr-surgery-worker.ts',
  '/assets/jpegxl-workbench.js': 'docs-astro/src/scripts/jpegxl-workbench.ts',
  '/assets/jpegxl-workbench-worker.js': 'docs-astro/src/scripts/jpegxl-workbench-worker.ts',
}

const jpegXlDemoAssets: Readonly<Record<string, string>> = {
  '/demo-data/jpegxl-progressive-yuv420.jpg':
    'benchmark/corpus/files/wpt-webcodecs-mozjpeg-yuv420.jpg',
  '/demo-data/jpegxl-progressive-yuv420.jxl':
    'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/baseline-yuv420.jxl',
}

const binaryAssets: Readonly<Record<string, string>> = {
  '/assets/jpeg-decoder.wasm': 'src/accelerator-entries/jpeg-decoder.wasm',
  '/assets/jpeg-decoder-simd.wasm': 'src/accelerator-entries/jpeg-decoder-simd.wasm',
  '/assets/jpeg-encoder.wasm': 'src/accelerator-entries/jpeg-encoder.wasm',
  '/assets/jpeg-encoder-simd.wasm': 'src/accelerator-entries/jpeg-encoder-simd.wasm',
  '/assets/png-codec.wasm': 'src/accelerator-entries/png-codec.wasm',
  '/assets/png-codec-simd.wasm': 'src/accelerator-entries/png-codec-simd.wasm',
}

export interface DocsDevAsset {
  readonly body: Uint8Array
  readonly contentType: string
  readonly rangeCapable?: boolean
}

let featureTourAssets: Promise<ReadonlyMap<string, Uint8Array>> | undefined
let geoFixtureAssets: Promise<ReadonlyMap<string, Uint8Array>> | undefined

const loadFeatureTourAsset = async (pathname: string): Promise<DocsDevAsset | undefined> => {
  if (!pathname.startsWith(featureTourPrefix)) return undefined
  if (featureTourAssets === undefined) {
    featureTourAssets = import('../benchmark/scientific-readers/generated-fixtures.ts').then(
      ({ generatedScientificFixtures }) => {
        const factory = generatedScientificFixtures['ome-zarr-feature-tour-generated']
        if (factory === undefined) throw new Error('Missing generated OME-Zarr Feature Tour')
        return new Map(
          factory().resources.map(({ name, bytes }) => [`${featureTourPrefix}${name}`, bytes]),
        )
      },
    )
  }
  const body = (await featureTourAssets).get(pathname)
  if (body === undefined) return undefined
  return {
    body,
    contentType: pathname.endsWith('.json')
      ? 'application/json; charset=utf-8'
      : 'application/octet-stream',
    rangeCapable: true,
  }
}

const loadGeoFixtureAsset = async (pathname: string): Promise<DocsDevAsset | undefined> => {
  if (!pathname.startsWith(geoFixturePrefix)) return undefined
  if (geoFixtureAssets === undefined) {
    geoFixtureAssets = readFile(
      resolve(repositoryRoot, 'tests/fixtures/cog/showcase-subifd-deflate-rotated.tif'),
    ).then((cog) => {
      const resources: Array<readonly [string, Uint8Array]> = [
        [`${geoFixturePrefix}overview-cog.tif`, cog],
        ...geoShowcaseZarrResources().map(
          ({ name, bytes }) => [`${geoFixturePrefix}geozarr-cube/${name}`, bytes] as const,
        ),
      ]
      return new Map(resources)
    })
  }
  const body = (await geoFixtureAssets).get(pathname)
  if (body === undefined) return undefined
  return {
    body,
    contentType: pathname.endsWith('.json')
      ? 'application/json; charset=utf-8'
      : pathname.endsWith('.tif')
        ? 'image/tiff'
        : 'application/octet-stream',
    rangeCapable: true,
  }
}

export const loadDocsDevAsset = async (pathname: string): Promise<DocsDevAsset | undefined> => {
  const featureTourAsset = await loadFeatureTourAsset(pathname)
  if (featureTourAsset !== undefined) return featureTourAsset
  const geoFixtureAsset = await loadGeoFixtureAsset(pathname)
  if (geoFixtureAsset !== undefined) return geoFixtureAsset

  if (pathname === '/demo-data/jpegxl-pixel-lossless.png') {
    return { body: jpegXlWorkbenchPng(), contentType: 'image/png' }
  }

  const jpegXlDemoAsset = jpegXlDemoAssets[pathname]
  if (jpegXlDemoAsset !== undefined) {
    return {
      body: await readFile(resolve(repositoryRoot, jpegXlDemoAsset)),
      contentType: pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/jxl',
    }
  }

  const scriptEntry = scriptEntries[pathname]
  if (scriptEntry !== undefined) {
    const result = await build({
      absWorkingDir: repositoryRoot,
      alias: geoShowcaseSourceAliases,
      bundle: true,
      charset: 'utf8',
      entryPoints: [scriptEntry],
      format: 'esm',
      legalComments: 'none',
      logLevel: 'silent',
      minify: false,
      platform: 'browser',
      sourcemap: 'inline',
      target: ['es2022'],
      write: false,
    })
    const output = result.outputFiles[0]
    if (output === undefined) throw new Error(`esbuild did not emit ${pathname}`)
    return { body: output.contents, contentType: 'text/javascript; charset=utf-8' }
  }

  const binaryAsset = binaryAssets[pathname]
  if (binaryAsset === undefined) return undefined
  return {
    body: await readFile(resolve(repositoryRoot, binaryAsset)),
    contentType: 'application/wasm',
  }
}

type NextMiddleware = (error?: unknown) => void

interface DocsDevServer {
  readonly config: {
    readonly logger: {
      error(message: string): void
    }
  }
  readonly middlewares: {
    use(
      middleware: (
        request: IncomingMessage,
        response: ServerResponse,
        next: NextMiddleware,
      ) => void,
    ): void
  }
}

export const docsDevAssets = () => ({
  name: 'purejsimage-docs-dev-assets',
  configureServer(server: DocsDevServer): void {
    server.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      try {
        const asset = await loadDocsDevAsset(pathname)
        if (asset === undefined) {
          next()
          return
        }
        response.statusCode = 200
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', asset.contentType)
        if (asset.rangeCapable === true) response.setHeader('Accept-Ranges', 'bytes')
        const range =
          asset.rangeCapable === true
            ? (request.headers.range?.match(/^bytes=(\d+)-(\d+)$/u) ?? undefined)
            : undefined
        if (
          asset.rangeCapable === true &&
          request.headers.range !== undefined &&
          range === undefined
        ) {
          response.statusCode = 416
          response.setHeader('Content-Length', '0')
          response.setHeader('Content-Range', `bytes */${asset.body.byteLength}`)
          response.end()
          return
        }
        if (range !== undefined) {
          const start = Number(range[1])
          const requestedEnd = Number(range[2])
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(requestedEnd) ||
            start < 0 ||
            requestedEnd < start ||
            start >= asset.body.byteLength
          ) {
            response.statusCode = 416
            response.setHeader('Content-Length', '0')
            response.setHeader('Content-Range', `bytes */${asset.body.byteLength}`)
            response.end()
            return
          }
          const end = Math.min(requestedEnd, asset.body.byteLength - 1)
          const body = asset.body.subarray(start, end + 1)
          response.statusCode = 206
          response.setHeader('Content-Length', String(body.byteLength))
          response.setHeader('Content-Range', `bytes ${start}-${end}/${asset.body.byteLength}`)
          response.end(request.method === 'HEAD' ? undefined : body)
          return
        }
        response.setHeader('Content-Length', String(asset.body.byteLength))
        response.end(request.method === 'HEAD' ? undefined : asset.body)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        server.config.logger.error(`Failed to build ${pathname}: ${message}`)
        response.statusCode = 500
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(message)
      }
    })
  },
})
