import { createHash } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const redirectStatuses: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
const defaultMaximumBytes = 64 * 1024 * 1024
const maximumRedirects = 5

export type DownloadFetch = (url: URL, init: { readonly redirect: 'manual' }) => Promise<Response>

export interface PinnedDownloadOptions {
  readonly allowedDirectory: string
  readonly allowedHosts: ReadonlySet<string>
  readonly destination: string
  readonly expectedSha256: string
  readonly fetch?: DownloadFetch
  readonly maximumBytes?: number
  readonly url: string
}

const fetchFromNetwork: DownloadFetch = (url, init) => {
  // Only a validated, approved HTTPS URL reaches this request; no local file contents are sent.
  // codeql[js/file-access-to-http]
  return globalThis.fetch(url, init)
}

const validatedDestination = (allowedDirectory: string, destination: string): string => {
  const directory = resolve(allowedDirectory)
  const target = resolve(destination)
  const pathFromDirectory = relative(directory, target)

  if (
    pathFromDirectory.length === 0 ||
    isAbsolute(pathFromDirectory) ||
    pathFromDirectory === '..' ||
    pathFromDirectory.startsWith(`..${sep}`) ||
    dirname(target) !== directory
  ) {
    throw new Error(`Download destination must be a direct child of ${directory}`)
  }

  return target
}

const validatedUrl = (value: string | URL, allowedHosts: ReadonlySet<string>): URL => {
  const url = value instanceof URL ? value : new URL(value)
  if (url.protocol !== 'https:') throw new Error(`Download URL must use HTTPS: ${url}`)
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`Download URL must not include credentials: ${url}`)
  }
  if (url.port.length > 0 && url.port !== '443') {
    throw new Error(`Download URL must use the default HTTPS port: ${url}`)
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`Download host is not approved: ${url.hostname}`)
  }
  return url
}

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

const replaceFile = async (temporary: string, destination: string): Promise<void> => {
  try {
    await rename(temporary, destination)
  } catch (error: unknown) {
    const code = errorCode(error)
    if (code !== 'EACCES' && code !== 'EEXIST' && code !== 'EPERM') throw error
    await rm(destination, { force: true })
    await rename(temporary, destination)
  }
}

const fetchWithValidatedRedirects = async (
  initialUrl: string,
  allowedHosts: ReadonlySet<string>,
  fetch: DownloadFetch,
): Promise<Response> => {
  let url = validatedUrl(initialUrl, allowedHosts)

  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual' })
    if (!redirectStatuses.has(response.status)) return response
    if (response.body !== null) await response.body.cancel()
    if (redirects === maximumRedirects) throw new Error('Download exceeded 5 redirects')

    const location = response.headers.get('location')
    if (location === null) throw new Error(`Download redirect from ${url} omitted Location`)
    url = validatedUrl(new URL(location, url), allowedHosts)
  }

  throw new Error('Download exceeded redirect limit')
}

const readResponse = async (response: Response, maximumBytes: number): Promise<Uint8Array> => {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
      throw new Error(`Download exceeds ${maximumBytes} byte limit`)
    }
  }

  if (response.body === null) throw new Error('Download response omitted a body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const result = await reader.read()
    if (result.done) break
    totalBytes += result.value.byteLength
    if (totalBytes > maximumBytes) {
      try {
        await reader.cancel()
      } catch {
        // Preserve the size-limit failure.
      }
      throw new Error(`Download exceeds ${maximumBytes} byte limit`)
    }
    chunks.push(result.value)
  }

  const data = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return data
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

export const downloadPinnedFile = async (options: PinnedDownloadOptions): Promise<void> => {
  const maximumBytes = options.maximumBytes ?? defaultMaximumBytes
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Download byte limit must be a positive safe integer')
  }
  if (!/^[a-f0-9]{64}$/.test(options.expectedSha256)) {
    throw new Error('Pinned download requires a lowercase SHA-256 checksum')
  }
  if (options.allowedHosts.size === 0) throw new Error('Pinned download requires approved hosts')

  const destination = validatedDestination(options.allowedDirectory, options.destination)
  const temporary = `${destination}.download`
  const fetch = options.fetch ?? fetchFromNetwork

  await rm(temporary, { force: true })
  try {
    const response = await fetchWithValidatedRedirects(options.url, options.allowedHosts, fetch)
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)

    const data = await readResponse(response, maximumBytes)
    const actualSha256 = sha256(data)
    if (actualSha256 !== options.expectedSha256) {
      throw new Error(
        `Download checksum mismatch: expected ${options.expectedSha256}, got ${actualSha256}`,
      )
    }

    // Network bytes reach disk only after matching the repository's exact pinned SHA-256.
    // codeql[js/http-to-file-access]
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
    await replaceFile(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}
