import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const scriptEntries: Readonly<Record<string, string>> = {
  '/assets/demo-app.js': 'docs-astro/src/scripts/demo.ts',
  '/assets/wsi-viewer.js': 'docs-astro/src/scripts/wsi-viewer.ts',
  '/assets/wsi-worker.js': 'docs-astro/src/scripts/wsi-worker.ts',
  '/assets/ome-zarr-viewer.js': 'docs-astro/src/scripts/ome-zarr-viewer.ts',
  '/assets/ome-zarr-worker.js': 'docs-astro/src/scripts/ome-zarr-worker.ts',
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
}

export const loadDocsDevAsset = async (pathname: string): Promise<DocsDevAsset | undefined> => {
  const scriptEntry = scriptEntries[pathname]
  if (scriptEntry !== undefined) {
    const result = await build({
      absWorkingDir: repositoryRoot,
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
