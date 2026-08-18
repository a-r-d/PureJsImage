import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeDicomText } from '../src/scientific/formats/dicom/elements.ts'
import {
  dicomTag,
  findDicomElement,
  parseDicomPart10,
} from '../src/scientific/formats/dicom/parser.ts'
import { readDicomOracle } from './dicom/oracle.ts'
import { TrackingSource } from './dicom/tracking-source.ts'

describe('DICOM development oracle', () => {
  it('matches pydicom technical tags when the optional oracle is installed', async () => {
    const path = 'tests/fixtures/dicom/synthetic-explicit-le.dcm'
    const oracle = readDicomOracle(path)
    if (!oracle.available) {
      expect(oracle.available).toBe(false)
      return
    }
    const parsed = await parseDicomPart10(new TrackingSource(readFileSync(path)))
    expect(oracle.transferSyntaxUid).toBe(parsed.transferSyntaxUid)
    const modality = oracle.elements?.find((element) => element.tag === '00080060')
    expect(modality?.vr).toBe('CS')
    expect(modality?.value).toBe(
      decodeDicomText(
        findDicomElement(parsed.dataset.elements, dicomTag.modality)?.value ?? new Uint8Array(),
      ),
    )
    const rows = oracle.elements?.find((element) => element.tag === '00280010')
    expect(rows?.value).toBe('4')
  })
})
