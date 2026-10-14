import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { encodeTransplant } from './transplant.ts'
import { libjxlPortOverrides, parseLibjxlPort } from './libjxl-ports.ts'

const [pngPath, outputPath, firstMode = 'standalone-reference', secondMode = 'standalone'] =
  process.argv.slice(2)
if (!pngPath || !outputPath)
  throw new Error('Usage: selector-speed.ts input.png output.json [base-mode candidate-mode]')
const input = PNG.sync.read(await readFile(pngPath))
const modes = [parseLibjxlPort(firstMode), parseLibjxlPort(secondMode)]
const pixels = Uint8Array.from(input.data)
const rows = []
for (let trial = -1; trial < 7; trial++) {
  for (const index of trial % 2 === 0 ? [0, 1] : [1, 0]) {
    const mode = modes[index]
    if (!mode) throw new Error('Missing mode')
    const start = performance.now()
    const result = await encodeTransplant(
      pixels,
      input.width,
      input.height,
      2,
      libjxlPortOverrides(mode, 2, input.width, input.height),
    )
    const milliseconds = performance.now() - start
    const row = {
      trial,
      mode,
      milliseconds,
      bytes: result.bytes.length,
      hash: createHash('sha256').update(result.bytes).digest('hex'),
      managedPeakBytes: result.managedPeakBytes,
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
}
await writeFile(
  outputPath,
  `${JSON.stringify({ pngPath, distance: 2, warmupTrial: -1, rows }, null, 2)}\n`,
)
