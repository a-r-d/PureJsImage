import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const directory = join('benchmark', 'jpegxl', 'production-program')
const jsonPath = join(directory, 'baseline.json')
const markdownPath = join(directory, 'baseline.md')

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

const parseJson = async (path: string): Promise<Readonly<Record<string, unknown>>> =>
  record(JSON.parse(await readFile(path, 'utf8')), path)

const sha256 = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

const source = await parseJson(join(directory, 'baseline-source.json'))
const measurements = await parseJson(join(directory, 'reference-measurements.json'))
const features = await parseJson(join(directory, 'feature-inventory.json'))
const packageJson = await parseJson('package.json')
const capabilityManifest = await parseJson(join('capabilities', 'manifest.json'))
const programState = await parseJson(join(directory, 'program-state.json'))

const baselineMainRevision = string(source.baselineMainRevision, 'baselineMainRevision')
const packageVersion = string(source.packageVersion, 'packageVersion')
if (packageJson.version !== packageVersion) {
  throw new Error(
    `package.json version ${String(packageJson.version)} differs from ${packageVersion}`,
  )
}

for (const entry of array(source.modules, 'modules')) {
  await access(string(record(entry, 'module').path, 'module.path'))
}
for (const claim of array(source.claimCoverage, 'claimCoverage')) {
  for (const evidence of array(record(claim, 'claim').evidence, 'claim.evidence')) {
    await access(string(evidence, 'claim evidence path'))
  }
}

const formats = array(capabilityManifest.codecs, 'capabilities.codecs')
const jpegXlCapability = formats
  .map((value) => record(value, 'capability format'))
  .find((value) => value.id === 'jpegxl')
if (!jpegXlCapability) throw new Error('capabilities/manifest.json has no jpegxl format')
const readCapability = record(jpegXlCapability.read, 'jpegxl.read')
const writeCapability = record(jpegXlCapability.write, 'jpegxl.write')
const milestones = record(programState.milestones, 'programState.milestones')
if (
  readCapability.status === 'supported' &&
  (readCapability.label === 'Common static sRGB' ||
    readCapability.label === 'Common static color and HDR' ||
    readCapability.label === 'Stable common static')
) {
  const milestone3 = record(milestones.M3, 'programState.milestones.M3')
  if (milestone3.stablePromotionGatePassed !== true) {
    throw new Error('Supported common static decoding requires the Milestone 3 promotion gate')
  }
  if (
    readCapability.label !== 'Common static sRGB' &&
    record(milestones.M4, 'programState.milestones.M4').stablePromotionGatePassed !== true
  ) {
    throw new Error('Supported color and HDR requires the Milestone 4 local promotion gate')
  }
  if (readCapability.label === 'Stable common static') {
    const milestone5 = record(milestones.M5, 'programState.milestones.M5')
    const pipelineCorpus = await parseJson(join(directory, 'm5-common-static.json'))
    if (
      milestone5.stablePromotionGatePassed !== true ||
      pipelineCorpus.passed !== true ||
      pipelineCorpus.incorrectOutputs !== 0 ||
      number(pipelineCorpus.decoded, 'M5 decoded') /
        (number(pipelineCorpus.decoded, 'M5 decoded') +
          number(pipelineCorpus.unsupported, 'M5 unsupported')) <
        0.99
    ) {
      throw new Error('Stable common static requires the M5 pipeline and corpus promotion gates')
    }
  }
} else if (readCapability.status !== 'limited' || readCapability.label !== 'Limited') {
  throw new Error('JPEG XL read capability has an unrecognized boundary')
}
if (writeCapability.status !== 'limited') {
  throw new Error('JPEG XL write capability no longer matches the recorded limited boundary')
}
if (
  writeCapability.label === 'Stable exact transcode' ||
  writeCapability.label === 'Stable lossless and exact transcode'
) {
  const milestone1 = record(milestones.M1, 'programState.milestones.M1')
  if (milestone1.stablePromotionGatePassed !== true) {
    throw new Error('Stable exact transcode requires the Milestone 1 promotion gate')
  }
  if (writeCapability.label === 'Stable lossless and exact transcode') {
    const milestone2 = record(milestones.M2, 'programState.milestones.M2')
    if (milestone2.stablePromotionGatePassed !== true) {
      throw new Error('Stable lossless encoding requires the Milestone 2 promotion gate')
    }
  }
} else if (writeCapability.label !== 'Experimental') {
  throw new Error('JPEG XL write capability has an unrecognized label')
}

const corpusDefinitions = [
  ['conformance', join(directory, 'corpora', 'conformance.json')],
  ['generatedFeatures', join(directory, 'corpora', 'generated-features.json')],
  ['realImages', join(directory, 'corpora', 'real-images.json')],
  ['jpegArchive', join(directory, 'corpora', 'jpeg-archive.json')],
] as const
const corpora: Record<string, Readonly<Record<string, unknown>>> = {}
for (const [id, path] of corpusDefinitions) {
  const manifest = await parseJson(path)
  const cases = manifest.cases ?? manifest.images ?? manifest.sources ?? manifest.fixtureManifests
  corpora[id] = Object.freeze({
    path,
    sha256: await sha256(path),
    entries: array(cases, `${id} entries`).length,
    revision: typeof manifest.revision === 'string' ? manifest.revision : null,
  })
}

const conformanceManifest = await parseJson(join(directory, 'corpora', 'conformance.json'))
const conformanceCounts: Record<string, number> = {
  pass: 0,
  'expected-unsupported': 0,
  'malformed-safely-rejected': 0,
  'incorrect-output': 0,
  'unexpected-failure': 0,
}
for (const value of array(conformanceManifest.cases, 'conformance cases')) {
  const classification = string(
    record(value, 'conformance case').baselineClassification,
    'classification',
  )
  if (!(classification in conformanceCounts))
    throw new Error(`Unknown classification ${classification}`)
  conformanceCounts[classification] = number(conformanceCounts[classification], classification) + 1
}

const featureFixtures = array(features.fixtures, 'feature inventory fixtures')
const report = Object.freeze({
  schemaVersion: 1,
  baselineMainRevision,
  packageVersion,
  environment: record(source.environment, 'environment'),
  moduleInventory: array(source.modules, 'modules'),
  publicApi: array(source.publicApi, 'publicApi'),
  capabilityMatrix: array(source.capabilityMatrix, 'capabilityMatrix'),
  claimCoverage: array(source.claimCoverage, 'claimCoverage'),
  corpora: Object.freeze(corpora),
  featureInventory: Object.freeze({
    path: join(directory, 'feature-inventory.json'),
    sha256: await sha256(join(directory, 'feature-inventory.json')),
    fixtures: featureFixtures.length,
  }),
  conformance: Object.freeze({
    total: array(conformanceManifest.cases, 'conformance cases').length,
    classifications: Object.freeze(conformanceCounts),
    policy: record(conformanceManifest.classificationPolicy, 'conformance classification policy'),
  }),
  measurements,
  knownUnsupported: array(source.knownUnsupported, 'knownUnsupported'),
  knownBaselineDefects: array(source.knownBaselineDefects, 'knownBaselineDefects'),
  capabilityPromotion: Object.freeze({ performed: false, stableGatePassed: false }),
})

const outputJson = `${JSON.stringify(report, null, 2)}\n`
const benchmark = record(measurements.benchmark, 'measurements.benchmark')
const compression = record(measurements.compression, 'measurements.compression')
const exactJpeg = record(measurements.exactJpeg, 'measurements.exactJpeg')
const browser = record(measurements.browser, 'measurements.browser')
const outputMarkdown =
  `# JPEG XL production-program baseline\n\n` +
  `This report records the Milestone 0 baseline. It does not promote a codec capability.\n\n` +
  `- Starting main revision: \`${baselineMainRevision}\`\n` +
  `- Package version: \`${packageVersion}\`\n` +
  `- Official conformance: ${conformanceCounts.pass} pass, ${conformanceCounts['expected-unsupported']} expected unsupported, ${conformanceCounts['malformed-safely-rejected']} malformed and safely rejected, ${conformanceCounts['incorrect-output']} incorrect output, ${conformanceCounts['unexpected-failure']} explained unexpected failure\n` +
  `- Extracted PR feature fixtures: ${featureFixtures.length}\n` +
  `- Exact JPEG reconstruction: ${String(exactJpeg.exactCases)}/${String(exactJpeg.totalCases)} eligible baseline cases\n` +
  `- Exact JPEG median JXL/source size ratio: ${String(exactJpeg.medianJxlToSourceRatio)}\n` +
  `- Encoder median JXL/PNG size ratio: ${String(compression.pureJsImageMedianRatioToPng)}\n` +
  `- Correctness-gated benchmark workloads: ${String(benchmark.workloads)}\n` +
  `- Browser workbench: Chromium ${String(browser.chromium)}, Firefox ${String(browser.firefox)}, WebKit ${String(browser.webkit)}\n\n` +
  `## Important boundaries\n\n` +
  `The official \`delta_palette\` case reaches \`INVALID_INPUT\`. The baseline classifies this as an explained unexpected failure, not as malformed input or supported behavior.\n\n` +
  `Wall-time and RSS values are reference-machine snapshots. Ordinary pull-request CI treats correctness, hashes, classifications, and resource-policy behavior as gates.\n\n` +
  `See \`baseline.json\` for the complete module, API, corpus, feature, compression, speed, memory, package-size, pipeline, and browser matrices.\n`

if (process.argv.includes('--write')) {
  await writeFile(jsonPath, outputJson)
  await writeFile(markdownPath, outputMarkdown)
} else if (process.argv.includes('--check')) {
  const currentJson: unknown = JSON.parse(await readFile(jsonPath, 'utf8'))
  if (JSON.stringify(currentJson) !== JSON.stringify(report)) {
    throw new Error(`${jsonPath} is not current; run render-baseline.ts --write`)
  }
  if ((await readFile(markdownPath, 'utf8')) !== outputMarkdown) {
    throw new Error(`${markdownPath} is not current; run render-baseline.ts --write`)
  }
} else {
  process.stdout.write(outputJson)
}
