import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import selection from './production-program/m7-corpus-expansion.json' with { type: 'json' }

const directory = '.tmp/jpegxl-m7/sources'
const manifestPath = 'benchmark/jpegxl/production-program/m7-expansion-downloads.json'
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
await mkdir(directory, { recursive: true })
let pinned: unknown
try {
  pinned = JSON.parse(await readFile(manifestPath, 'utf8'))
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
}
const previous = object(pinned) && Array.isArray(pinned.cases) ? pinned.cases : []
async function download(url: string, maximum: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PureJsImage-M7-Benchmark/0.17' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${url}`)
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > maximum) throw new Error(`Source exceeds ${maximum} bytes`)
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
const results: object[] = []
let failures = 0
for (const entry of [...selection.hdr, ...selection.artwork]) {
  try {
    const prior = previous.find((value: unknown) => object(value) && value.id === entry.id)
    if (
      !object(prior) ||
      prior.status !== 'verified' ||
      typeof prior.sourceSha256 !== 'string' ||
      typeof prior.bytes !== 'number' ||
      !Number.isSafeInteger(prior.bytes) ||
      prior.bytes < 1
    )
      throw new Error('Missing pinned expansion source record')
    let sourceUrl: string
    let providerMd5: string | undefined
    let providerBytes: number | undefined
    let metadataSha256: string | undefined
    const format = 'asset' in entry ? 'hdr' : 'png'
    if ('asset' in entry) {
      const metadataBytes = await download(entry.metadataUrl, 2_000_000)
      metadataSha256 = sha256(metadataBytes)
      if (metadataSha256 !== prior.metadataSha256)
        throw new Error('Provider metadata checksum changed')
      const metadata: unknown = JSON.parse(new TextDecoder().decode(metadataBytes))
      const hdri = object(metadata) ? metadata.hdri : undefined
      const resolution = object(hdri) ? hdri['2k'] : undefined
      const hdr = object(resolution) ? resolution.hdr : undefined
      if (
        !object(hdr) ||
        typeof hdr.url !== 'string' ||
        typeof hdr.md5 !== 'string' ||
        typeof hdr.size !== 'number' ||
        !Number.isSafeInteger(hdr.size) ||
        hdr.size < 1
      )
        throw new Error('Invalid provider HDR metadata')
      sourceUrl = hdr.url
      providerMd5 = hdr.md5
      providerBytes = hdr.size
      if (new URL(sourceUrl).hostname !== 'dl.polyhaven.org') throw new Error('Unexpected HDR host')
    } else sourceUrl = entry.sourceUrl
    const path = `${directory}/${entry.id}.${format}`
    let bytes: Uint8Array
    try {
      bytes = await readFile(path)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      if (prior.sourceUrl !== sourceUrl) throw new Error('Previously pinned source URL changed')
      await downloadPinnedFile({
        allowedDirectory: directory,
        allowedHosts: new Set(['dl.polyhaven.org', 'raw.githubusercontent.com']),
        destination: path,
        expectedSha256: prior.sourceSha256,
        maximumBytes: Math.min(prior.bytes, 40_000_000),
        url: sourceUrl,
      })
      bytes = await readFile(path)
    }
    const sourceSha256 = sha256(bytes)
    if (
      prior.sourceSha256 !== sourceSha256 ||
      prior.bytes !== bytes.length ||
      prior.sourceUrl !== sourceUrl
    )
      throw new Error('Previously pinned source changed')
    if (providerBytes !== undefined && bytes.length !== providerBytes)
      throw new Error('Provider size mismatch')
    if (providerMd5 !== undefined && createHash('md5').update(bytes).digest('hex') !== providerMd5)
      throw new Error('Provider MD5 mismatch')
    results.push({ ...prior })
    console.log(entry.id, 'verified', bytes.length)
  } catch (error) {
    failures++
    results.push({
      id: entry.id,
      split: entry.split,
      status: 'failed',
      error: 'Verification failed; inspect console output',
    })
    console.error(entry.id, String(error))
  }
}
await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, cases: results }, null, 2)}\n`)
if (failures) process.exitCode = 1
