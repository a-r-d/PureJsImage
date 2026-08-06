import { allFixtures, inspectFixture, readManifest, verifyInspection } from '../lib/corpus.ts'

const manifest = await readManifest()
let failures = 0

for (const fixture of allFixtures(manifest)) {
  try {
    const inspection = await inspectFixture(fixture)
    const errors = verifyInspection(fixture, inspection)
    if (errors.length > 0) {
      failures += 1
      console.error(`FAIL ${fixture.id}: ${errors.join('; ')}`)
      continue
    }
    console.log(
      `PASS ${fixture.id.padEnd(32)} ${inspection.format.padEnd(4)} ${String(inspection.width).padStart(5)}x${String(inspection.height).padEnd(5)} ${String(inspection.bytes).padStart(10)} bytes ${inspection.sha256}`,
    )
  } catch (error) {
    failures += 1
    console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures > 0) {
  process.exitCode = 1
}
