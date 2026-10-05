/** Read section sizes at the pinned, adequately matched public photo endpoints. */
import { readFile } from 'node:fs/promises'
import { JpegXlCodestreamSource } from '../../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../../src/codecs/jpegxl-decode.ts'
import { inspectJpegXl } from '../../../src/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'
import { inspectJpegXlVarDctStrategyIds } from '../inspect-vardct-strategies.ts'
import { hash, implementationIdentity, json, root } from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'

const [output, qualityReport] = process.argv.slice(2)
if (!output || process.argv.length > 4)
  throw new Error('Specify a fresh lossy section profile report and optional PureJsImage curves')
const identity = await implementationIdentity()
const paths = [
  qualityReport ?? `${root}/results/quality-alpha-left-public.json`,
  `${root}/results/quality-refined-photo.json`,
]
const reports = []
for (const path of paths) {
  const bytes = await readFile(path)
  const parsed: unknown = JSON.parse(bytes.toString('utf8'))
  reports.push({ path, sha256: hash(bytes), report: object(parsed) })
}
const fixture = 'im26-1030-diagnostic'
const results = []
let expectedInput: string | undefined
for (const [index, report] of reports.entries()) {
  const rows = report.report.results
  if (!Array.isArray(rows)) throw new Error('Missing public curves')
  for (const value of rows) {
    const row = object(value)
    const subject = string(row.subject)
    if (
      row.fixture !== fixture ||
      (index === 0 ? subject !== 'purejsimage' : !['jsquash', 'vips'].includes(subject))
    )
      continue
    const inputSha256 = string(row.inputSha256)
    expectedInput ??= inputSha256
    if (inputSha256 !== expectedInput) throw new Error('Comparison input differs')
    if (!Array.isArray(row.bands)) throw new Error('Missing bands')
    for (const value of row.bands) {
      const band = object(value)
      if (band.status !== 'adequate bracket' || number(band.width) > 0.25)
        throw new Error('Section comparison requires adequately matched bands')
      const bracket = object(band.bracket)
      for (const side of ['lower', 'upper'] as const) {
        const point = object(bracket[side])
        const path = string(point.artifact)
        const bytes = await readFile(path)
        if (hash(bytes) !== point.artifactSha256 || bytes.length !== number(point.bytes))
          throw new Error('Pinned artifact changed')
        const inspection = await inspectJpegXl(bytes)
        const logical = new JpegXlCodestreamSource(new MemorySource(bytes), inspection)
        const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
        const frame = frames.at(-1)
        if (!frame || frame.encoding !== 'vardct' || frame.frameType !== 'regular')
          throw new Error('Expected a final VarDCT display frame')
        // These pinned 1024x768 inputs use one DC group and separated sections.
        if (frame.codedWidth !== 1024 || frame.codedHeight !== 768 || frame.sections.length < 4)
          throw new Error('Unexpected pinned photo geometry')
        const sectionBytes = frame.sections.map((section) => section.length)
        const otherFrames = frames.slice(0, -1).map((frame) => ({
          type: frame.frameType,
          encoding: frame.encoding,
          width: frame.codedWidth,
          height: frame.codedHeight,
          sectionBytes: frame.sections.map((section) => section.length),
        }))
        const otherFrameSectionBytes = otherFrames.reduce(
          (sum, frame) => sum + frame.sectionBytes.reduce((total, length) => total + length, 0),
          0,
        )
        results.push({
          fixture,
          subject,
          target: number(band.target),
          side,
          setting: number(point.setting),
          score: number(point.score),
          butteraugli: number(point.butteraugli),
          bracketWidth: number(band.width),
          artifact: path,
          artifactSha256: hash(bytes),
          inputSha256,
          bytes: bytes.length,
          containerOverheadBytes: bytes.length - inspection.codestreamBytes,
          otherFrames,
          otherFrameSectionBytes,
          containerFrameHeaderAndTocBytes:
            bytes.length -
            otherFrameSectionBytes -
            sectionBytes.reduce((sum, length) => sum + length, 0),
          lfGlobalBytes: sectionBytes[0],
          dcGroupBytes: sectionBytes[1],
          hfGlobalBytes: sectionBytes[2],
          acGroupBytes: sectionBytes.slice(3).reduce((sum, length) => sum + length, 0),
          sectionBytes,
          gaborish: frame.gaborish,
          epfIterations: frame.epfIterations,
          strategies: await inspectJpegXlVarDctStrategyIds(logical, frames),
        })
        validateImplementationIdentity(await implementationIdentity(), identity)
      }
    }
  }
}
if (results.length !== 18) throw new Error('Missing matched endpoints')
await json(output, {
  schemaVersion: 1,
  date: new Date().toISOString(),
  ...identity,
  harnessSha256: hash(await readFile(import.meta.filename)),
  sourceReports: reports.map(({ path, sha256 }) => ({ path, sha256 })),
  policy:
    'Read encoded section sizes and strategy IDs from all 18 adequately bracketed pinned public photo endpoints at SSIMULACRA2 70/80/90. Check input/artifact hashes. Reuse recorded independently validated metrics; this profile does not rescore images or prove causation from strategy IDs alone.',
  results,
})
for (const row of results.filter((row) => row.target === 80))
  console.log(
    `${row.subject} ${row.side}: ${row.bytes} bytes, DC ${row.dcGroupBytes}, AC ${row.acGroupBytes}, score ${row.score}`,
  )
