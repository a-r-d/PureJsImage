import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { hash, json, root, work } from './io.ts'

await build({
  entryPoints: [`${root}/preview-worker.ts`],
  outfile: `${work}/preview-worker.js`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  tsconfigRaw: { compilerOptions: {} },
})
const path =
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
  input = await readFile(path)
const server = createServer(async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    if (req.url === '/input.jxl') {
      const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '')
      if (!match) throw new Error('Range required')
      const start = Number(match[1]),
        end = Number(match[2])
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${input.length}`)
      res.end(input.subarray(start, end + 1))
    } else if (req.url === '/worker.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(await readFile(`${work}/preview-worker.js`))
    } else if (req.url === '/oxide.wasm') {
      res.setHeader('Content-Type', 'application/wasm')
      res.end(await readFile(`${work}/assets/oxide.wasm`))
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><title>JPEG XL preview probe</title>')
    }
  } catch (error) {
    res.statusCode = 500
    res.end(String(error))
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Missing address')
const browser = await chromium.launch({ headless: true }),
  rows: unknown[] = []
try {
  for (const subject of ['purejsimage', 'oxide'] as const)
    for (let repeat = 0; repeat < 3; repeat++) {
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        await page.goto(`http://127.0.0.1:${address.port}`)
        const result: unknown = await page.evaluate(
          ({ subject, size }) =>
            new Promise((resolve, reject) => {
              const worker = new Worker('/worker.js', { type: 'module' }),
                timer = setTimeout(() => {
                  worker.terminate()
                  reject(new Error('Preview timeout'))
                }, 60000)
              worker.onmessage = (event) => {
                clearTimeout(timer)
                worker.terminate()
                resolve(event.data)
              }
              worker.onerror = (event) => {
                clearTimeout(timer)
                worker.terminate()
                reject(new Error(event.message))
              }
              worker.postMessage({ subject, size })
            }),
          { subject, size: input.length },
        )
        rows.push({ subject, repeat, result })
      } finally {
        await context.close()
      }
    }
} finally {
  await browser.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
await json(`${root}/results/preview-chromium.json`, {
  schemaVersion: 1,
  date: new Date().toISOString(),
  browser: browser.version(),
  fixture: { path, sha256: hash(input), bytes: input.length },
  rows,
  limitations:
    'Loopback HTTP, no latency/bandwidth emulation. PureJsImage requests a region at scale 2; oxide renders a full frame and exports PNG. Preview workloads differ and timings must not be ranked as equivalent. Requested and transferred source bytes exclude JS/WASM assets, enumerated separately.',
})
