import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  dicomTag,
  explicitVrLittleEndianUid,
  implicitVrLittleEndianUid,
} from '../../src/scientific/formats/dicom/constants.ts'
import { dicomTextBytes, dicomUInt16Bytes, writeDicomPart10 } from './part10-writer.ts'

const pixel = Uint8Array.from({ length: 32 }, () => 0xab)
const dataset = [
  {
    tag: dicomTag.sopClassUid,
    vr: 'UI' as const,
    value: dicomTextBytes('1.2.840.10008.5.1.4.1.1.7'),
  },
  {
    tag: dicomTag.sopInstanceUid,
    vr: 'UI' as const,
    value: dicomTextBytes('1.2.826.0.1.3680043.10.850.1.1'),
  },
  { tag: dicomTag.modality, vr: 'CS' as const, value: dicomTextBytes('OT') },
  { tag: dicomTag.rows, vr: 'US' as const, value: dicomUInt16Bytes(4) },
  { tag: dicomTag.columns, vr: 'US' as const, value: dicomUInt16Bytes(4) },
  { tag: dicomTag.bitsAllocated, vr: 'US' as const, value: dicomUInt16Bytes(16) },
  { tag: dicomTag.pixelData, vr: 'OW' as const, value: pixel },
]

const explicit = writeDicomPart10({ transferSyntax: 'explicit-vr-le', dataset })
const implicit = writeDicomPart10({ transferSyntax: 'implicit-vr-le', dataset })
writeFileSync('tests/fixtures/dicom/synthetic-explicit-le.dcm', explicit)
writeFileSync('tests/fixtures/dicom/synthetic-implicit-le.dcm', implicit)

const files = [
  {
    localFile: 'synthetic-explicit-le.dcm',
    sha256: createHash('sha256').update(explicit).digest('hex'),
    source: {
      generator: 'tests/dicom/part10-writer.ts',
      revision: 'workspace-generated',
      license: 'MIT',
      redistribution: 'included-test-only',
    },
    transferSyntaxUid: explicitVrLittleEndianUid,
    expected: { modality: 'OT', rows: 4, columns: 4, sopClassUid: '1.2.840.10008.5.1.4.1.1.7' },
  },
  {
    localFile: 'synthetic-implicit-le.dcm',
    sha256: createHash('sha256').update(implicit).digest('hex'),
    source: {
      generator: 'tests/dicom/part10-writer.ts',
      revision: 'workspace-generated',
      license: 'MIT',
      redistribution: 'included-test-only',
    },
    transferSyntaxUid: implicitVrLittleEndianUid,
    expected: { modality: 'OT', rows: 4, columns: 4, sopClassUid: '1.2.840.10008.5.1.4.1.1.7' },
  },
]

writeFileSync(
  'tests/fixtures/dicom/corpus.json',
  `${JSON.stringify(
    {
      schemaVersion: 1,
      description:
        'Synthetic DICOM Part 10 fixtures for parser D0/D1 tests. No patient identifiers.',
      files,
    },
    null,
    2,
  )}\n`,
)

process.stdout.write(
  `Wrote synthetic DICOM fixtures (${explicit.byteLength} + ${implicit.byteLength} bytes).\n`,
)
