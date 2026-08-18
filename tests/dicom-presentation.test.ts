import { describe, expect, it } from 'vitest'
import { ImageError } from '../src/errors.ts'
import { dicomTag } from '../src/scientific/formats/dicom/constants.ts'
import {
  applyDicomModalityTransform,
  applyDicomVoiWindow,
  type DicomVoiPreset,
  parseDicomStoredValueTransform,
  parseDicomVoiPresets,
} from '../src/scientific/formats/dicom/presentation.ts'
import { dicomDecimalBytes, dicomTextBytes } from './dicom/part10-writer.ts'

const element = (tag: number, value: Uint8Array) =>
  Object.freeze({
    tag,
    retired: false,
    known: true,
    private: false,
    headerOffset: 0,
    valueOffset: 0,
    valueLength: value.byteLength,
    undefinedLength: false,
    value,
  })

describe('DICOM modality and VOI presentation', () => {
  it('applies linear rescale independently of stored samples', () => {
    const transform = {
      kind: 'linear' as const,
      slope: 1,
      intercept: -1024,
      type: 'HU',
    }
    expect(applyDicomModalityTransform(0, transform)).toBe(-1024)
    expect(applyDicomModalityTransform(1024, transform)).toBe(0)
    expect(applyDicomModalityTransform(2048, transform)).toBe(1024)
  })

  it('matches the DICOM LINEAR window formula', () => {
    const preset: DicomVoiPreset = { center: 40, width: 80, function: 'LINEAR' }
    expect(applyDicomVoiWindow(0, preset, 0, 1)).toBe(0)
    expect(applyDicomVoiWindow(80, preset, 0, 1)).toBe(1)
    expect(applyDicomVoiWindow(40, preset, 0, 1)).toBeCloseTo(0.5 / 79 + 0.5, 12)
    expect(applyDicomVoiWindow(-0.1, preset, 0, 255)).toBe(0)
    expect(applyDicomVoiWindow(79.1, preset, 0, 255)).toBe(255)
  })

  it('matches the DICOM LINEAR_EXACT and SIGMOID formulas', () => {
    const exact: DicomVoiPreset = { center: 40, width: 80, function: 'LINEAR_EXACT' }
    expect(applyDicomVoiWindow(0, exact, 0, 1)).toBe(0)
    expect(applyDicomVoiWindow(80, exact, 0, 1)).toBe(1)
    expect(applyDicomVoiWindow(40, exact, 0, 1)).toBe(0.5)
    const sigmoid: DicomVoiPreset = { center: 40, width: 80, function: 'SIGMOID' }
    expect(applyDicomVoiWindow(40, sigmoid, 0, 1)).toBe(0.5)
    expect(applyDicomVoiWindow(40, sigmoid, 10, 210)).toBe(110)
    expect(applyDicomVoiWindow(-1_000, sigmoid, 0, 1)).toBeCloseTo(0, 8)
    expect(applyDicomVoiWindow(1_000, sigmoid, 0, 1)).toBeCloseTo(1, 8)
  })

  it('parses paired rescale and multiple window presets', () => {
    const transform = parseDicomStoredValueTransform([
      element(dicomTag.rescaleSlope, dicomDecimalBytes(1)),
      element(dicomTag.rescaleIntercept, dicomDecimalBytes(-1024)),
      element(dicomTag.rescaleType, dicomTextBytes('HU')),
    ])
    expect(transform).toEqual({ kind: 'linear', slope: 1, intercept: -1024, type: 'HU' })
    const presets = parseDicomVoiPresets([
      element(dicomTag.windowCenter, dicomDecimalBytes(40, -600)),
      element(dicomTag.windowWidth, dicomDecimalBytes(80, 1500)),
      element(dicomTag.windowCenterWidthExplanation, dicomTextBytes('SOFT_TISSUE\\LUNG')),
      element(dicomTag.voiLutFunction, dicomTextBytes('LINEAR')),
    ])
    expect(presets).toEqual([
      { center: 40, width: 80, explanation: 'SOFT_TISSUE', function: 'LINEAR' },
      { center: -600, width: 1500, explanation: 'LUNG', function: 'LINEAR' },
    ])
  })

  it('rejects unpaired or illegal window and rescale attributes', () => {
    expect(() =>
      parseDicomStoredValueTransform([element(dicomTag.rescaleSlope, dicomDecimalBytes(1))]),
    ).toThrow(ImageError)
    expect(() =>
      parseDicomVoiPresets([element(dicomTag.windowCenter, dicomDecimalBytes(40))]),
    ).toThrow(/paired/)
    expect(() =>
      parseDicomVoiPresets([
        element(dicomTag.windowCenter, dicomDecimalBytes(40)),
        element(dicomTag.windowWidth, dicomDecimalBytes(0)),
      ]),
    ).toThrow(/at least 1/)
    expect(() =>
      parseDicomVoiPresets([
        element(dicomTag.windowCenter, dicomDecimalBytes(40)),
        element(dicomTag.windowWidth, dicomDecimalBytes(80)),
        element(dicomTag.voiLutFunction, dicomTextBytes('UNKNOWN')),
      ]),
    ).toThrow(/VOI LUT Function/)
  })
})
