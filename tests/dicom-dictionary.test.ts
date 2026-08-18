import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dicomTag } from '../src/scientific/formats/dicom/constants.ts'
import {
  getDicomDictionarySource,
  lookupDicomDictionary,
  resolveImplicitVr,
} from '../src/scientific/formats/dicom/dictionary.ts'

describe('DICOM PS3.6 dictionary', () => {
  it('records the pinned 2026c edition, source, and hash', () => {
    const source = getDicomDictionarySource()
    expect(source.edition).toBe('2026c')
    expect(source.url).toBe(
      'https://dicom.nema.org/medical/dicom/current/source/docbook/part06/part06.xml',
    )
    expect(source.title).toBe('DICOM PS3.6 2026c - Data Dictionary')
    expect(source.sha256).toBe('ff1dcdfb557d57db96420614fcaf6d739bb76aa74b73eba77f367be9fab0be3e')
    expect(source.byteLength).toBe(9_665_786)
    expect(source.tables).toEqual(['6-1', '7-1', '8-1', '9-1'])
    expect(source.entryCount).toBe(source.exactCount + source.patternCount)
    expect(source.exactCount).toBeGreaterThan(5_000)
    expect(source.patternCount).toBeGreaterThan(80)
    const generated = readFileSync('src/scientific/formats/dicom/dictionary.generated.ts', 'utf8')
    expect(generated).toContain(source.artifactSha256)
    expect(generated).toContain(source.sha256)
  })

  it('looks up exact tags, repeating groups, and keeps private tags unknown', () => {
    const transferSyntax = lookupDicomDictionary(dicomTag.transferSyntaxUid)
    expect(transferSyntax.known).toBe(true)
    expect(transferSyntax.entry?.keyword).toBe('TransferSyntaxUID')
    expect(transferSyntax.entry?.vr).toBe('UI')
    expect(resolveImplicitVr(dicomTag.pixelData)).toBe('OW')
    expect(resolveImplicitVr(0x0008_1115)).toBe('SQ')
    const overlay = lookupDicomDictionary(0x6012_0010)
    expect(overlay.known).toBe(true)
    expect(overlay.entry?.keyword).toBe('OverlayRows')
    expect(overlay.entry?.pattern).toBe(true)
    const privateCreator = lookupDicomDictionary(0x0009_0010)
    expect(privateCreator).toMatchObject({ known: false, private: true })
    expect(privateCreator.entry).toBeUndefined()
    const unknownStandard = lookupDicomDictionary(0x0008_9999)
    expect(unknownStandard).toMatchObject({ known: false, private: false })
  })

  it('matches the deterministic generator output', () => {
    const output = execFileSync('node', ['scripts/dicom/generate-dictionary.ts', '--check'], {
      encoding: 'utf8',
    })
    expect(output).toContain('DICOM dictionary 2026c is current')
    const registry = readFileSync('scripts/dicom/ps3.6-2026c-registry.json')
    expect(createHash('sha256').update(registry).digest('hex')).toHaveLength(64)
  })
})
