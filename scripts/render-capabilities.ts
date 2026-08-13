import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  capabilityClaims,
  type CapabilityLevel,
  type CodecCapability,
  readCapabilityManifest,
} from './capability-manifest.ts'

const checkOnly = process.argv.includes('--check')
const generatedMarkdownNotice =
  '<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->'

const html = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const replaceRegion = (source: string, name: string, replacement: string): string => {
  const start = `<!-- capabilities:${name}:start -->`
  const end = `<!-- capabilities:${name}:end -->`
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`Missing generated capability region ${name}`)
  }
  const contentStart = startIndex + start.length
  const endLineStart = source.lastIndexOf('\n', endIndex - 1) + 1
  const endIndent = source.slice(endLineStart, endIndex)
  return `${source.slice(0, contentStart)}\n${replacement.trimEnd()}\n${endIndent}${source.slice(endIndex)}`
}

const publicCodecs = (codecs: readonly CodecCapability[]): readonly CodecCapability[] =>
  codecs.filter(({ packageFormat }) => packageFormat !== undefined)

const readmeBlock = (codecs: readonly CodecCapability[]): string => {
  const rows = codecs.map(({ name, read, write }) => `| ${name} | ${read.label} | ${write.label} |`)
  const links = codecs.map(
    ({ name, supportFile }) =>
      `[${name}](https://github.com/a-r-d/PureJsImage/blob/main/${supportFile})`,
  )
  const linkedRoadmaps = links
    .map((link, index) => {
      if (index === links.length - 1) return `and ${link}.`
      return `${link},`
    })
    .join('\n')
  return [
    '| Format | Read | Write |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '“Limited” means PureJsImage supports a useful subset and clearly rejects files',
    'outside it.',
    '“Experimental” means the codec is excluded from `allCodecs` and requires an',
    'explicit direct import and registration.',
    '',
    '[See the exact codec support matrix →](https://purejsimage.com/codecs/)',
    '',
    'Detailed codec compatibility roadmaps:',
    linkedRoadmaps,
  ].join('\n')
}

const statusHtml = (level: CapabilityLevel): string => {
  if (level.status === 'supported') return `<span class="yes">● ${html(level.label)}</span>`
  if (level.status === 'limited') return `<span class="partial">● ${html(level.label)}</span>`
  return `<span class="no">${html(level.label)}</span>`
}

const matrixBlock = (codecs: readonly CodecCapability[]): string => {
  const rows = codecs.map(
    (codec) =>
      `            <tr><td><strong>${html(codec.name)}</strong></td><td>${statusHtml(codec.read)}</td><td>${statusHtml(codec.write)}</td><td>${html(codec.boundary)}</td></tr>`,
  )
  return [
    '          <div class="table-wrap"><table><thead><tr><th>Codec</th><th>Decode</th><th>Encode</th><th>Primary boundary</th></tr></thead><tbody>',
    ...rows,
    '          </tbody></table></div>',
  ].join('\n')
}

const cardStatus = (
  codec: CodecCapability,
): { readonly className: string; readonly label: string } => {
  if (codec.write.status === 'supported') return { className: 'stable', label: 'Decode + encode' }
  if (codec.write.status === 'limited') {
    return { className: 'stable', label: 'Decode + limited encode' }
  }
  if (codec.read.status === 'supported') return { className: 'decode', label: 'Decode only' }
  return { className: 'expanding', label: `${codec.read.label} decode` }
}

const cardsBlock = (codecs: readonly CodecCapability[]): string => {
  const cards = codecs.map((codec) => {
    const status = cardStatus(codec)
    return `            <article class="card codec-card" id="${html(codec.id)}"><div class="codec-card-head"><h3>${html(codec.name)}</h3><span class="status ${status.className}">${html(status.label)}</span></div><p>${html(codec.description)}</p><a class="card-link" href="https://github.com/a-r-d/PureJsImage/blob/main/${html(codec.supportFile)}" target="_blank" rel="noreferrer">Full ${html(codec.name)} checklist →</a></article>`
  })
  return ['          <div class="codec-grid">', ...cards, '          </div>'].join('\n')
}

const memoryBlock = (codecs: readonly CodecCapability[]): string => {
  const rows = codecs.map(
    (codec) =>
      `            <tr><td><strong>${html(codec.name)}</strong></td><td>${html(codec.memory)}</td></tr>`,
  )
  return [
    '          <div class="table-wrap"><table><thead><tr><th>Path</th><th>Current working model</th></tr></thead><tbody>',
    ...rows,
    '          </tbody></table></div>',
  ].join('\n')
}

const outputsBlock = (codecs: readonly CodecCapability[]): string => {
  const encoders = codecs.filter(
    ({ write }) => write.status === 'supported' || write.status === 'limited',
  )
  return [
    '          <ul>',
    ...encoders.map(
      (codec) =>
        `            <li><strong>${html(codec.name)}:</strong> ${html(codec.recommendation)}</li>`,
    ),
    '          </ul>',
  ].join('\n')
}

interface CodecImport {
  readonly entry: string
  readonly exports: string
}

const codecImport = (codec: CodecCapability): CodecImport => {
  if (codec.id === 'jp2') {
    return {
      entry: 'purejsimage/codecs/jpeg2000',
      exports: 'jpeg2000Codec',
    }
  }
  if (codec.id === 'heif') {
    return {
      entry: 'purejsimage/codecs/experimental/heic',
      exports: 'experimentalHeicCodec, experimentalHeifCodec',
    }
  }
  return {
    entry: `purejsimage/codecs/${codec.id}`,
    exports: `${codec.id}Codec`,
  }
}

const llmsBlock = (codecs: readonly CodecCapability[]): string => {
  const sections = codecs.flatMap((codec) => {
    const packageImport = codecImport(codec)
    return [
      `### ${codec.name}`,
      '',
      `- Import: \`import { ${packageImport.exports} } from '${packageImport.entry}'\``,
      `- Decode: ${codec.read.label} (\`${codec.read.status}\`)`,
      `- Encode: ${codec.write.label} (\`${codec.write.status}\`)`,
      `- Implemented scope: ${codec.description}`,
      `- Primary boundary: ${codec.boundary}`,
      `- Memory model: ${codec.memory}`,
      `- Recommended output use: ${codec.recommendation}`,
      `- Full checked capability contract: https://github.com/a-r-d/PureJsImage/blob/main/${codec.supportFile}`,
      '',
    ]
  })
  return [
    '## Codec capability map',
    '',
    'This section is generated from `capabilities/manifest.json`. Status and boundary text are evidence-backed public claims. Read each linked checklist before relying on an uncommon format subset.',
    '',
    ...sections,
  ].join('\n')
}

const generatedExpectations = (codecs: readonly CodecCapability[]): string => {
  const expectations = codecs.map((codec) => ({
    id: codec.id,
    format: codec.packageFormat,
    decoder: codec.read.status === 'supported' || codec.read.status === 'limited',
    encoder: codec.write.status === 'supported' || codec.write.status === 'limited',
    evidence: codec.evidence,
    lossyPixelValidation: codec.lossyPixelValidation,
  }))
  return `${JSON.stringify({ schemaVersion: 1, codecs: expectations }, null, 2)}\n`
}

const publicJson = (manifestCodecs: readonly CodecCapability[]): string => {
  const codecs = manifestCodecs.map((codec) => ({
    id: codec.id,
    name: codec.name,
    ...(codec.packageFormat ? { packageFormat: codec.packageFormat } : {}),
    read: codec.read,
    write: codec.write,
    boundary: codec.boundary,
    description: codec.description,
    memory: codec.memory,
    recommendation: codec.recommendation,
    evidence: codec.evidence,
    lossyPixelValidation: codec.lossyPixelValidation,
    claims: capabilityClaims(codec.document),
  }))
  return `${JSON.stringify({ schemaVersion: 1, codecs }, null, 2)}\n`
}

const manifest = await readCapabilityManifest()
const codecs = publicCodecs(manifest.codecs)
const jpegxl = codecs.find(({ id }) => id === 'jpegxl')
if (!jpegxl) throw new Error('Capability manifest is missing JPEG XL')
const outputs = new Map<string, string>()

const readme = await readFile('README.md', 'utf8')
outputs.set('README.md', replaceRegion(readme, 'readme', readmeBlock(codecs)))

let llmsGuide = await readFile('docs-astro/public/llms.txt', 'utf8')
llmsGuide = llmsGuide.replace(
  /`allCodecs` contains JPEG, PNG, WebP, BMP, TIFF, GIF, ICO, JPEG 2000, AVIF, and [^\n]+/,
  '`allCodecs` contains JPEG, PNG, WebP, BMP, TIFF, GIF, ICO, JPEG 2000, AVIF, and the limited JPEG XL decoder. It intentionally excludes experimental HEIF/HEIC. JPEG XL files outside the documented lossless Modular subset fail explicitly.',
)
outputs.set('docs-astro/public/llms.txt', replaceRegion(llmsGuide, 'llms', llmsBlock(codecs)))

let codecPage = await readFile('docs-astro/src/pages/codecs.astro', 'utf8')
codecPage = replaceRegion(codecPage, 'matrix', matrixBlock(codecs))
codecPage = replaceRegion(codecPage, 'cards', cardsBlock(codecs))
codecPage = replaceRegion(codecPage, 'memory', memoryBlock(codecs))
codecPage = replaceRegion(codecPage, 'outputs', outputsBlock(codecs))
codecPage = codecPage.replace(
  /The registered JPEG XL entry validates structure, but metadata and pixel decoding remain explicitly unsupported\./,
  `JPEG XL is registered for limited decode: ${jpegxl.boundary}.`,
)
codecPage = codecPage.replace(
  /CUR is not a current codec entry point\. JPEG XL now has .*? The linked scope documents describe possible implementation subsets; unchecked items are not current capability claims or release commitments\./,
  'CUR is not a current codec entry point. JPEG XL has a limited lossless Modular decoder; broader syntax remains planned. The linked scope documents define the exact implemented and unsupported boundaries.',
)
outputs.set('docs-astro/src/pages/codecs.astro', codecPage)

for (const codec of manifest.codecs) {
  outputs.set(codec.supportFile, `${generatedMarkdownNotice}\n${codec.document.trimEnd()}\n`)
}
outputs.set('docs-astro/public/capabilities.json', publicJson(manifest.codecs))
outputs.set('tests/generated/capability-expectations.json', generatedExpectations(codecs))

const jsonEquivalent = (actual: string, expected: string): boolean => {
  try {
    const actualValue: unknown = JSON.parse(actual)
    const expectedValue: unknown = JSON.parse(expected)
    return JSON.stringify(actualValue) === JSON.stringify(expectedValue)
  } catch {
    return false
  }
}

const stale: string[] = []
for (const [path, expected] of outputs) {
  if (checkOnly) {
    const actual = await readFile(path, 'utf8').catch(() => undefined)
    const matches =
      actual !== undefined &&
      (path.endsWith('.json') ? jsonEquivalent(actual, expected) : actual === expected)
    if (!matches) stale.push(path)
    continue
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, expected)
}

if (stale.length > 0) {
  throw new Error(
    `Generated capability outputs are stale:\n${stale.map((path) => `- ${path}`).join('\n')}\nRun npm run capabilities:generate.`,
  )
}

if (!checkOnly) console.log(`Generated ${outputs.size} capability outputs.`)
