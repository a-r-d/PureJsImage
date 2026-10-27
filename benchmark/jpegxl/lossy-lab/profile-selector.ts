import { readFile, writeFile } from 'node:fs/promises'
import { number, object, string } from '../comparison/model.ts'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Need CPU profile and output JSON')
const profile = object(JSON.parse(await readFile(input, 'utf8')))
if (
  !Array.isArray(profile.nodes) ||
  !Array.isArray(profile.samples) ||
  !Array.isArray(profile.timeDeltas)
)
  throw new Error('Invalid CPU profile')
const nodes = new Map(
  profile.nodes.map((value) => {
    const n = object(value)
    return [number(n.id), object(n.callFrame)]
  }),
)
const totals = new Map<number, number>()
for (let i = 0; i < profile.samples.length; i++) {
  const id = number(profile.samples[i])
  totals.set(id, (totals.get(id) ?? 0) + number(profile.timeDeltas[i]))
}
const rows = [...totals]
  .map(([id, us]) => {
    const frame = nodes.get(id)
    if (!frame) throw new Error('Unknown sample node')
    return {
      functionName: string(frame.functionName),
      url: string(frame.url),
      line: number(frame.lineNumber) + 1,
      milliseconds: us / 1000,
    }
  })
  .sort((a, b) => b.milliseconds - a.milliseconds)
await writeFile(output, `${JSON.stringify({ input, rows }, null, 2)}\n`)
console.log(JSON.stringify(rows.filter((r) => r.url.includes('/jpegxl')).slice(0, 20), null, 2))
