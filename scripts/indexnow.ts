import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const siteOrigin = 'https://purejsimage.com'
const siteHost = 'purejsimage.com'
const sitemapIndexUrl = `${siteOrigin}/sitemap-index.xml`
const indexNowEndpoint = 'https://api.indexnow.org/indexnow'
const indexNowKeyPattern = /^[A-Za-z0-9-]{8,128}$/u
const maximumUrlCount = 10_000

export interface IndexNowPayload {
  readonly host: string
  readonly key: string
  readonly keyLocation: string
  readonly urlList: readonly string[]
}

export const validateIndexNowKey = (value: string): string => {
  if (!indexNowKeyPattern.test(value)) {
    throw new Error('INDEXNOW_KEY must contain 8 to 128 letters, numbers, or dashes')
  }
  return value
}

const decodeXmlText = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")

export const extractSitemapLocations = (xml: string): readonly string[] => {
  const locations: string[] = []
  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gu)) {
    const value = match[1]
    if (value !== undefined && value.trim() !== '') {
      locations.push(decodeXmlText(value.trim()))
    }
  }
  return locations
}

const validateSiteUrl = (value: string, label: string): string => {
  const url = new URL(value)
  if (url.origin !== siteOrigin) {
    throw new Error(`${label} must use ${siteOrigin}: ${value}`)
  }
  return url.href
}

export const createIndexNowPayload = (
  keyValue: string,
  urlValues: readonly string[],
): IndexNowPayload => {
  const key = validateIndexNowKey(keyValue)
  const urlList = [...new Set(urlValues.map((value) => validateSiteUrl(value, 'IndexNow URL')))]
  if (urlList.length === 0) throw new Error('IndexNow submission has no URLs')
  if (urlList.length > maximumUrlCount) {
    throw new Error(`IndexNow submission exceeds ${maximumUrlCount.toLocaleString()} URLs`)
  }
  return {
    host: siteHost,
    key,
    keyLocation: `${siteOrigin}/${key}.txt`,
    urlList,
  }
}

const fetchWithRetry = async (url: string, attempts = 5): Promise<Response> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'PureJsImage-IndexNow/1.0' },
      })
      if (response.ok) return response
      lastError = new Error(`${url} returned HTTP ${response.status}`)
    } catch (error: unknown) {
      lastError = error
    }
    if (attempt < attempts) {
      await new Promise<void>((resolveDelay) => {
        setTimeout(resolveDelay, attempt * 2_000)
      })
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`Failed to fetch ${url}: ${detail}`)
}

const readRemoteText = async (url: string): Promise<string> => {
  const response = await fetchWithRetry(url)
  return response.text()
}

const readPublishedUrls = async (): Promise<readonly string[]> => {
  const sitemapIndex = await readRemoteText(sitemapIndexUrl)
  const sitemapUrls = extractSitemapLocations(sitemapIndex)
  if (sitemapUrls.length === 0) throw new Error('Published sitemap index has no sitemap URLs')

  const publishedUrls = new Set<string>()
  for (const sitemapValue of sitemapUrls) {
    const sitemapUrl = validateSiteUrl(sitemapValue, 'Sitemap URL')
    const sitemap = await readRemoteText(sitemapUrl)
    for (const pageValue of extractSitemapLocations(sitemap)) {
      publishedUrls.add(validateSiteUrl(pageValue, 'Published page URL'))
    }
  }
  return [...publishedUrls]
}

const prepareKeyFile = async (key: string): Promise<void> => {
  const outputDirectory = resolve(
    process.env.INDEXNOW_OUTPUT_DIRECTORY ?? 'benchmark/.tmp/docs-site',
  )
  await mkdir(outputDirectory, { recursive: true })
  const keyFile = resolve(outputDirectory, `${key}.txt`)
  await writeFile(keyFile, key, 'utf8')
  console.log(`Prepared IndexNow verification file ${keyFile}`)
}

const submitPublishedUrls = async (key: string): Promise<void> => {
  const keyLocation = `${siteOrigin}/${key}.txt`
  const publishedKey = (await readRemoteText(keyLocation)).trim()
  if (publishedKey !== key) {
    throw new Error('Published IndexNow verification file does not match INDEXNOW_KEY')
  }

  const payload = createIndexNowPayload(key, await readPublishedUrls())
  const response = await fetch(indexNowEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'user-agent': 'PureJsImage-IndexNow/1.0',
    },
    body: JSON.stringify(payload),
  })
  if (response.status !== 200 && response.status !== 202) {
    const detail = (await response.text()).trim()
    throw new Error(
      `IndexNow returned HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
    )
  }
  console.log(`IndexNow accepted ${payload.urlList.length} URLs with HTTP ${response.status}`)
}

const main = async (): Promise<void> => {
  const key = validateIndexNowKey(process.env.INDEXNOW_KEY ?? '')
  const command = process.argv[2]
  if (command === 'prepare') {
    await prepareKeyFile(key)
    return
  }
  if (command === 'submit') {
    await submitPublishedUrls(key)
    return
  }
  throw new Error('Usage: node scripts/indexnow.ts <prepare|submit>')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await main()
}
