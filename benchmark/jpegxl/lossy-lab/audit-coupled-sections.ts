import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
} from '../../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../../src/codecs/jpegxl-decode.ts'
import { resolveJpegXlLimits } from '../../../src/codecs/jpegxl-limits.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'

const root = '.tmp/jpegxl-lossy-lab/coupled-20261013'
async function sections(path: string) {
  const bytes = await readFile(path)
  const source = new MemorySource(bytes)
  const structure = await inspectJpegXlSource(source, resolveJpegXlLimits())
  const logical = new JpegXlCodestreamSource(source, structure)
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const frame = frames.at(-1)
  if (!frame || frame.encoding !== 'vardct' || frame.sections.length <= 1)
    throw new Error('Expected separated VarDCT sections')
  const startAc = 2 + frame.dcGroupCount
  const ac = createHash('sha256')
  let acBytes = 0,
    dcBytes = 0
  for (let i = 1; i < frame.sections.length; i++) {
    const section = frame.sections[i]
    if (!section) throw new Error('Missing section')
    if (i <= frame.dcGroupCount) dcBytes += section.length
    if (i >= startAc) {
      acBytes += section.length
      ac.update(await logical.read(section.offset, section.length))
    }
  }
  return { bytes: bytes.length, dcBytes, acBytes, acHash: ac.digest('hex') }
}
const beforeDir = `${root}/strategy-quant-filters-screen/coupled-strategy-quant-filters-purejsimage`
const afterDir = `${root}/strategy-quant-dc-screen/coupled-strategy-quant-dc-purejsimage`
const rows: {
  id: string
  distance: number
  before: Awaited<ReturnType<typeof sections>>
  after: Awaited<ReturnType<typeof sections>>
}[] = []
for (const id of await readdir(beforeDir))
  for (const distance of [0.5, 1, 2, 4, 7]) {
    rows.push({
      id,
      distance,
      before: await sections(`${beforeDir}/${id}/${distance}.jxl`),
      after: await sections(`${afterDir}/${id}/${distance}.jxl`),
    })
  }
const summary = [0.5, 1, 2, 4, 7].map((distance) => {
  const matching = rows.filter((r) => r.distance === distance)
  const beforeBytes = matching.reduce((s, r) => s + r.before.bytes, 0)
  const afterBytes = matching.reduce((s, r) => s + r.after.bytes, 0)
  return {
    distance,
    count: matching.length,
    acIdentical: matching.filter((r) => r.before.acHash === r.after.acHash).length,
    beforeBytes,
    afterBytes,
    sizeChangePercent: 100 * (afterBytes / beforeBytes - 1),
    beforeDcBytes: matching.reduce((s, r) => s + r.before.dcBytes, 0),
    afterDcBytes: matching.reduce((s, r) => s + r.after.dcBytes, 0),
  }
})
await writeFile(`${root}/sections-audit.json`, JSON.stringify({ summary, rows }, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
