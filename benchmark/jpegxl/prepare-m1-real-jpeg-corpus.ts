import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { inspectJpegReconstructionEligibility } from '../../src/jpegxl.ts'

interface CocoImage {
  readonly id: number
  readonly license: number
  readonly fileName: string
  readonly cocoUrl: string
  readonly flickrUrl: string
  readonly width: number
  readonly height: number
}

interface CocoLicense {
  readonly id: number
  readonly name: string
  readonly url: string
}

interface CorpusManifestCase {
  readonly id: string
  readonly fileName: string
  readonly sourcePath: string
  readonly cocoUrl: string
  readonly originalUrl: string
  readonly license: Readonly<{ id: number; name: string; url: string }>
  readonly sha256: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly progressive: boolean
  readonly sampling: readonly string[]
  readonly expected: 'eligible-exact'
}

const object = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Readonly<Record<string, unknown>>
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`)
  return value as number
}

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const parseImage = (value: unknown): CocoImage => {
  const image = object(value, 'COCO image')
  return Object.freeze({
    id: integer(image.id, 'COCO image id'),
    license: integer(image.license, 'COCO image license'),
    fileName: string(image.file_name, 'COCO image file_name'),
    cocoUrl: string(image.coco_url, 'COCO image coco_url'),
    flickrUrl: string(image.flickr_url, 'COCO image flickr_url'),
    width: integer(image.width, 'COCO image width'),
    height: integer(image.height, 'COCO image height'),
  })
}

const parseLicense = (value: unknown): CocoLicense => {
  const license = object(value, 'COCO license')
  return Object.freeze({
    id: integer(license.id, 'COCO license id'),
    name: string(license.name, 'COCO license name'),
    url: string(license.url, 'COCO license url'),
  })
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const corpusDirectory = process.argv[2] ?? '.tmp/jpegxl-m1-coco'
const outputPath =
  process.argv[3] ?? 'benchmark/jpegxl/production-program/corpora/jpeg-archive-coco-val2017.json'
const annotationsPath = join(corpusDirectory, 'annotations', 'instances_val2017.json')
const annotations = object(
  JSON.parse(await readFile(annotationsPath, 'utf8')) as unknown,
  'COCO annotations root',
)
const licenses = array(annotations.licenses, 'COCO licenses').map(parseLicense)
const licenseById = new Map(licenses.map((license) => [license.id, license]))
const allowedLicenseIds = new Set([1, 2, 3, 4, 5, 6, 7, 8])
const minimumSourceBytes = 224 * 1_024
const candidates = array(annotations.images, 'COCO images')
  .map(parseImage)
  .filter(({ license }) => allowedLicenseIds.has(license))
  .sort((left, right) => left.id - right.id)

const eligibleCases: CorpusManifestCase[] = []
for (const candidate of candidates) {
  const path = join(corpusDirectory, 'val2017', candidate.fileName)
  const source = new Uint8Array(await readFile(path))
  if (source.byteLength < minimumSourceBytes) continue
  const eligibility = await inspectJpegReconstructionEligibility(source)
  if (!eligibility.eligible || !eligibility.sourceProfile) continue
  const license = licenseById.get(candidate.license)
  if (!license) throw new Error(`COCO image ${candidate.id} references a missing license`)
  eligibleCases.push(
    Object.freeze({
      id: `coco-val2017-${candidate.id.toString().padStart(12, '0')}`,
      fileName: candidate.fileName,
      sourcePath: `val2017/${candidate.fileName}`,
      cocoUrl: candidate.cocoUrl,
      originalUrl: candidate.flickrUrl,
      license: Object.freeze({ id: license.id, name: license.name, url: license.url }),
      sha256: sha256(source),
      bytes: source.byteLength,
      width: candidate.width,
      height: candidate.height,
      progressive: eligibility.sourceProfile.progressive,
      sampling: eligibility.sourceProfile.sampling,
      expected: 'eligible-exact',
    }),
  )
}

eligibleCases.sort((left, right) => left.id.localeCompare(right.id))
if (eligibleCases.length < 250) {
  throw new Error(`Only ${eligibleCases.length} eligible, permitted COCO JPEGs were found`)
}
const cases = Array.from({ length: 250 }, (_, index) => {
  const selected = eligibleCases[Math.floor((index * (eligibleCases.length - 1)) / 249)]
  if (!selected) throw new Error('COCO corpus selection is incomplete')
  return selected
})

if (cases.length !== 250) {
  throw new Error(`Only ${cases.length} eligible, permitted COCO JPEGs were found; expected 250`)
}

const output = Object.freeze({
  schemaVersion: 1,
  kind: 'jpegxl-m1-real-jpeg-corpus',
  source: Object.freeze({
    dataset: 'COCO 2017 validation images',
    datasetUrl: 'https://cocodataset.org/#download',
    imageArchiveUrl: 'http://images.cocodataset.org/zips/val2017.zip',
    imageArchiveSha256: '4f7e2ccb2866ec5041993c9cf2a952bbed69647b115d0f74da7ce8f4bef82f05',
    annotationsArchiveUrl: 'http://images.cocodataset.org/annotations/annotations_trainval2017.zip',
    annotationsArchiveSha256: '113a836d90195ee1f884e704da6304dfaaecff1f023f49b6ca93c4aaae470268',
  }),
  selectionPolicy: Object.freeze({
    order: '250 evenly spaced records across ascending COCO image id',
    licenses: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]),
    minimumSourceBytes,
    eligibleCandidateCount: eligibleCases.length,
    eligibility: 'PureJsImage exact JPEG reconstruction eligibility',
    count: 250,
  }),
  cases: Object.freeze(cases),
})

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${cases.length} real JPEG records to ${outputPath}`)
