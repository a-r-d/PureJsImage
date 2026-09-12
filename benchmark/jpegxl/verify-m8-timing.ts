import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { openJpegXlSequence } from '../../src/jpegxl.ts'
import { hashM8Sources } from './m8-output-digest.ts'

const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/jxlinfo'
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const nativeSha256 = digest(await readFile(native))
if (nativeSha256 !== 'd02df1a4e28581ee4ed08dda3f8df09e3cd868d7dbc48db23bae8291a61d7ce0')
  throw new Error('Pinned native inspector hash differs')
const results = []
for (const id of ['animation_newtons_cradle', 'animation_icos4d', 'animation_spline']) {
  const path = `.tmp/jpegxl-conformance/testcases/${id}/input.jxl`,
    input = await readFile(path)
  const description = execFileSync(native, ['-v', path], { encoding: 'utf8', timeout: 120000 })
  const rate = /Ticks per second \(numerator \/ denominator\): (\d+) \/ (\d+)/.exec(description)
  const loops = /Num loops: (\d+)/.exec(description),
    timecodes = /Have timecodes: (\d+)/.exec(description)
  if (!rate || !loops || !timecodes) throw new Error(`${id}: native animation metadata missing`)
  const reference: unknown = JSON.parse(
    await readFile(`.tmp/jpegxl-conformance/testcases/${id}/test.json`, 'utf8'),
  )
  if (
    typeof reference !== 'object' ||
    reference === null ||
    !('frames' in reference) ||
    !Array.isArray(reference.frames)
  )
    throw new Error('Invalid official timing reference')
  const sequence = await openJpegXlSequence(input)
  const frames = []
  let ticks = 0n
  try {
    for await (const header of sequence.headers()) {
      if (
        header.isPreview ||
        header.frameType !== 'regular' ||
        (!header.isLast && !header.duration)
      )
        continue
      const animation = header.animation
      if (
        !animation ||
        animation.ticksPerSecondNumerator !== Number(rate[1]) ||
        animation.ticksPerSecondDenominator !== Number(rate[2]) ||
        animation.loops !== Number(loops[1]) ||
        animation.haveTimecodes !== (timecodes[1] === '1')
      )
        throw new Error(`${id}: native timebase/loops/timecode flag differs`)
      const expected: unknown = reference.frames[frames.length]
      if (
        typeof expected !== 'object' ||
        expected === null ||
        !('duration' in expected) ||
        typeof expected.duration !== 'number'
      )
        throw new Error('Invalid official duration')
      const seconds =
        ((header.duration ?? 0) * animation.ticksPerSecondDenominator) /
        animation.ticksPerSecondNumerator
      if (Math.abs(seconds - expected.duration) > 0.00000051)
        throw new Error(`${id}: official frame duration differs`)
      frames.push({
        index: frames.length,
        startTicks: String(ticks),
        durationTicks: header.duration,
        nativeSeconds: expected.duration,
        animation,
      })
      ticks += BigInt(header.duration ?? 0)
    }
  } finally {
    await sequence.close()
  }
  if (frames.length !== reference.frames.length)
    throw new Error(`${id}: displayed frame count differs`)
  results.push({
    id,
    inputSha256: digest(input),
    nativeDescriptionSha256: digest(new TextEncoder().encode(description)),
    frames,
    traversalTicks: String(ticks),
    passed: true,
  })
}
const report = {
  sourceSha256: await hashM8Sources(),
  nativeSha256,
  passed: true,
  results,
}
await writeFile(
  'benchmark/jpegxl/production-program/m8-timing-native.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    passed: true,
    cases: results.length,
    frames: results.reduce((sum, result) => sum + result.frames.length, 0),
  }),
)
