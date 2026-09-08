import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspectJpegXl } from '../src/codecs/jpegxl-inspect.ts'
import { openJpegXlSession } from '../src/codecs/jpegxl-session.ts'

const path = 'tests/fixtures/jpegxl/m6-preview/'
describe('JPEG XL embedded preview', () => {
  it('keeps the embedded image separate from DC and the full canvas', async () => {
    const input = readFileSync(`${path}embedded-preview.jxl`)
    const inspection = await inspectJpegXl(input)
    expect([inspection.width, inspection.height, inspection.preview]).toEqual([43, 35, true])
    const session = await openJpegXlSession(input)
    const kinds: string[] = []
    let actual = new Uint8Array(),
      offset = 0,
      index = 0
    for await (const event of session.progressive()) {
      if (event.type === 'stage-start') {
        kinds.push(event.stage.kind)
        actual = new Uint8Array(event.stage.width * event.stage.height * 3)
        offset = 0
      } else if (event.type === 'block') {
        actual.set(event.block.data, offset)
        offset += event.block.data.length
        event.block.release?.()
      } else if (event.type === 'stage-complete') {
        const expected = readFileSync(
          `${path}oracle/${index === 0 ? 'embedded-preview.bin' : `stage-${index - 1}.bin`}`,
        )
        expect(actual.length).toBe(expected.length)
        let maximum = 0
        for (let sample = 0; sample < actual.length; sample++)
          maximum = Math.max(maximum, Math.abs((actual[sample] ?? 0) - (expected[sample] ?? 0)))
        expect(maximum, event.stage.kind).toBeLessThanOrEqual(1)
        index++
      }
    }
    expect(kinds).toEqual(['embedded-preview', 'dc', 'pass', 'pass', 'final'])
    await session.close()
    expect(session.managedLiveBytes).toBe(0)
  })
})

it('renders display-coordinate native stages correctly through all eight orientations', async () => {
  const provenance: unknown = JSON.parse(readFileSync(`${path}provenance.json`, 'utf8'))
  if (
    typeof provenance !== 'object' ||
    provenance === null ||
    !('orientationBitOffset' in provenance) ||
    typeof provenance.orientationBitOffset !== 'number'
  )
    throw new Error('Missing orientation field location')
  const bitOffset = provenance.orientationBitOffset
  const source = readFileSync(`${path}embedded-preview.jxl`)
  for (let orientation = 1; orientation <= 8; orientation++) {
    const bytes = Uint8Array.from(source)
    for (let bit = 0; bit < 3; bit++) {
      const position = bitOffset + bit,
        byte = position >>> 3,
        mask = 1 << (position & 7)
      bytes[byte] =
        ((bytes[byte] ?? 0) & ~mask) | ((((orientation - 1) >>> bit) & 1) << (position & 7))
    }
    const session = await openJpegXlSession(bytes)
    expect(session.orientation).toBe(orientation)
    for (const until of ['dc', 1, 2, 'final'] as const) {
      const expected = readFileSync(
        `${path}oracle/stage-${until === 'dc' ? 0 : until === 'final' ? 3 : until}.bin`,
      )
      for await (const event of session.decode({
        coordinateSpace: 'display',
        region: { x: 2, y: 3, width: 10, height: 12 },
        scaleDenominator: 2,
        until,
      })) {
        if (event.type !== 'block') continue
        const block = event.block
        for (let column = 0; column < block.width; column++) {
          const x = 2 + column * 2 + 1,
            y = 3 + block.y * 2 + 1
          const sx =
            orientation === 1 || orientation === 4
              ? x
              : orientation === 2 || orientation === 3
                ? 42 - x
                : orientation === 5 || orientation === 6
                  ? y
                  : 42 - y
          const sy =
            orientation === 1 || orientation === 2
              ? y
              : orientation === 3 || orientation === 4
                ? 34 - y
                : orientation === 5 || orientation === 8
                  ? x
                  : 34 - x
          for (let channel = 0; channel < 3; channel++)
            expect(
              Math.abs(
                (block.data[column * 3 + channel] ?? 0) -
                  (expected[(sy * 43 + sx) * 3 + channel] ?? 0),
              ),
            ).toBeLessThanOrEqual(1)
        }
        block.release?.()
      }
    }
    await session.close()
  }
})

it('emits an independent Modular embedded preview and a separate final main image', async () => {
  const directory = 'tests/fixtures/jpegxl/m6-preview-modular/'
  const input = new Uint8Array(readFileSync(`${directory}embedded-preview.jxl`))
  const session = await openJpegXlSession(input)
  const completed: string[] = []
  let actual = new Uint8Array(),
    offset = 0
  for await (const event of session.progressive()) {
    if (event.type === 'stage-start') {
      actual = new Uint8Array(event.stage.width * event.stage.height * 3)
      offset = 0
    } else if (event.type === 'block') {
      actual.set(event.block.data, offset)
      offset += event.block.data.length
      event.block.release?.()
    } else if (event.type === 'stage-complete') {
      const expected = readFileSync(
        `${directory}oracle/${event.stage.kind === 'embedded-preview' ? 'embedded-preview.bin' : 'stage-0.bin'}`,
      )
      expect(actual).toEqual(new Uint8Array(expected))
      completed.push(event.stage.kind)
    }
  }
  expect(completed).toEqual(['embedded-preview', 'final'])
  expect(session.managedPeakBytes).toBeNull()
  await session.close()
})
