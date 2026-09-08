import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decodeJpegXlModularDcFrameSection,
  decodeJpegXlMultiGroupModularDcFrameSections,
  readJpegXlSourceFrameStructures,
} from '../src/codecs/jpegxl-decode.ts'
import { planJpegXlProgressive } from '../src/codecs/jpegxl-progressive-plan.ts'
import { JpegXlVarDctMemoryLedger } from '../src/codecs/jpegxl-vardct-memory.ts'
import {
  decodeJpegXlDct8Section,
  prepareJpegXlVarDctLowFrequency,
  renderJpegXlVarDctLowFrequency,
} from '../src/codecs/jpegxl-vardct-render.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const prepare = async (id: string) => {
  const bytes = readFileSync(`benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/${id}.jxl`)
  const frames = await readJpegXlSourceFrameStructures(new MemorySource(bytes), defaultImageLimits)
  const frame = frames.at(-1)
  if (!frame) throw new Error('Missing frame')
  const sections = frame.sections.map(({ offset, length }) =>
    bytes.subarray(offset, offset + length),
  )
  const first = sections[0]
  if (!first) throw new Error('Missing section')
  let dc: readonly [Float64Array, Float64Array, Float64Array] | undefined
  const dependency = frames.length > 1 ? frames[0] : undefined
  if (dependency) {
    const parts = dependency.sections.map(({ offset, length }) =>
      bytes.subarray(offset, offset + length),
    )
    const firstPart = parts[0]
    if (!firstPart) throw new Error('Missing DC section')
    dc = parts.slice(1).every((part) => part.length === 0)
      ? decodeJpegXlModularDcFrameSection(firstPart, dependency.codedWidth, dependency.codedHeight)
      : decodeJpegXlMultiGroupModularDcFrameSections(parts, dependency)
  }
  const memory = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
  const state = prepareJpegXlVarDctLowFrequency(
    sections.slice(0, 1 + frame.dcGroupCount),
    frame,
    memory,
    dc,
  )
  return { frame, sections, first, dc, memory, state }
}

const maximumError = (actual: Uint8Array, expected: Uint8Array): number => {
  expect(actual.length).toBe(expected.length)
  let maximum = 0
  for (let index = 0; index < actual.length; index += 1)
    maximum = Math.max(maximum, Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)))
  return maximum
}

describe('JPEG XL progressive reconstruction', () => {
  it('maps display viewports through all eight orientations before selecting dependency groups', async () => {
    const { frame, state } = await prepare('rgb8-distance1-multi-group-progressive')
    const expected = [
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 473, y: 20, width: 30, height: 40 },
      { x: 473, y: 325, width: 30, height: 40 },
      { x: 10, y: 325, width: 30, height: 40 },
      { x: 20, y: 10, width: 40, height: 30 },
      { x: 20, y: 345, width: 40, height: 30 },
      { x: 453, y: 345, width: 40, height: 30 },
      { x: 453, y: 10, width: 40, height: 30 },
    ]
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const plan = planJpegXlProgressive(
        { ...frame, orientation },
        { coordinateSpace: 'display', region: { x: 10, y: 20, width: 30, height: 40 } },
      )
      expect(plan.encodedRegion).toEqual(expected[orientation - 1])
      expect(plan.dependencyValidation).toBe('required')
    }
    const dc = planJpegXlProgressive(frame, { until: 'dc', scaleDenominator: 8 }, state)
    expect(dc.sectionIds).toEqual([0, 1])
    state.release()
  })

  it('keeps a completed preview and its cached LF state valid after a corrupt later pass', async () => {
    const { frame, sections, first, dc, memory, state } = await prepare(
      'rgb8-distance2-progressive',
    )
    const preview = renderJpegXlVarDctLowFrequency(state, 8)
    const snapshot = preview.data.slice()
    preview.release()
    const retained = memory.liveBytes
    const damaged = sections.map((section, index) =>
      index === sections.length - 1 ? new Uint8Array(section.length) : section,
    )
    expect(() =>
      decodeJpegXlDct8Section(
        first,
        frame,
        defaultImageLimits,
        memory,
        damaged.slice(1),
        dc,
        false,
        new Map(),
        state,
      ),
    ).toThrow()
    expect(memory.liveBytes).toBe(retained)
    expect(preview.data).toEqual(snapshot)
    const final = decodeJpegXlDct8Section(
      first,
      frame,
      defaultImageLimits,
      memory,
      sections.slice(1),
      dc,
      false,
      new Map(),
      state,
    )
    expect(
      maximumError(final.data, readFileSync('tests/fixtures/jpegxl/m6-progressive/stage-3.bin')),
    ).toBeLessThanOrEqual(1)
    final.release()
    state.release()
    expect(memory.liveBytes).toBe(0)
  })

  it('matches pinned C API DC and successive pass flushes while reusing unchanged LF state', async () => {
    const { frame, sections, first, dc, memory, state } = await prepare(
      'rgb8-distance2-progressive',
    )
    const retainedLfBytes = memory.liveBytes
    const preview = renderJpegXlVarDctLowFrequency(state, 1)
    const snapshot = preview.data.slice()
    expect(
      maximumError(preview.data, readFileSync('tests/fixtures/jpegxl/m6-progressive/stage-0.bin')),
    ).toBeLessThanOrEqual(1)
    preview.release()
    for (const pass of [1, 2, 3]) {
      // Missing later pass sections cannot accidentally be read by an earlier stage.
      const selected = sections.map((part, index) =>
        index < 2 + frame.dcGroupCount + pass * frame.groupsAcross * frame.groupsDown
          ? part
          : new Uint8Array(),
      )
      const pixels = decodeJpegXlDct8Section(
        first,
        frame,
        defaultImageLimits,
        memory,
        selected.slice(1),
        dc,
        false,
        new Map(),
        state,
        pass,
      )
      expect(
        maximumError(
          pixels.data,
          readFileSync(`tests/fixtures/jpegxl/m6-progressive/stage-${pass}.bin`),
        ),
      ).toBeLessThanOrEqual(1)
      pixels.release()
      expect(memory.liveBytes).toBe(retainedLfBytes)
      expect(preview.data).toEqual(snapshot)
    }
    state.release()
    state.release()
    expect(memory.liveBytes).toBe(0)
    expect(() => renderJpegXlVarDctLowFrequency(state)).toThrow(/released/)
  })

  it('samples the native DC stage on its 1/8 grid with bounded restoration storage', async () => {
    const { frame, memory, state } = await prepare('rgb8-distance2-progressive')
    const reference = readFileSync('tests/fixtures/jpegxl/m6-progressive/stage-0.bin')
    const preview = renderJpegXlVarDctLowFrequency(state, 8)
    const expected = new Uint8Array(preview.data.length)
    for (let y = 0; y < preview.height; y += 1) {
      for (let x = 0; x < preview.width; x += 1) {
        const source =
          (Math.min(frame.height - 1, y * 8 + 4) * frame.width +
            Math.min(frame.width - 1, x * 8 + 4)) *
          3
        expected.set(reference.subarray(source, source + 3), (y * preview.width + x) * 3)
      }
    }
    expect(maximumError(preview.data, expected)).toBeLessThanOrEqual(1)
    preview.release()
    state.release()
    expect(memory.liveBytes).toBe(0)
  })

  it('reconstructs a selected region without reading unrelated coefficient sections', async () => {
    const { frame, sections, first, dc, memory, state } = await prepare(
      'rgb8-distance1-multi-group-progressive',
    )
    const full = decodeJpegXlDct8Section(
      first,
      frame,
      defaultImageLimits,
      memory,
      sections.slice(1),
      dc,
      false,
      new Map(),
      state,
    )
    const plan = planJpegXlProgressive(
      frame,
      { region: { x: 10, y: 10, width: 20, height: 20 } },
      state,
    )
    const selected = sections.map((part, index) =>
      plan.sectionIds.includes(index) ? part : new Uint8Array(),
    )
    const region = decodeJpegXlDct8Section(
      first,
      frame,
      defaultImageLimits,
      memory,
      selected.slice(1),
      dc,
      false,
      new Map(),
      state,
      frame.passCount,
      new Set(plan.groupIds),
    )
    for (let y = 10; y < 30; y += 1) {
      const offset = (y * frame.width + 10) * 3
      expect(region.data.subarray(offset, offset + 60)).toEqual(
        full.data.subarray(offset, offset + 60),
      )
    }
    region.release()
    full.release()
    state.release()
    expect(memory.liveBytes).toBe(0)
  })
})
