import { describe, expect, it } from 'vitest'
import {
  isCurrentFourDStemWorkerResponseSequence,
  isFourDStemWorkerRequest,
  isFourDStemWorkerResponse,
  type FourDStemEvidenceSnapshot,
  type FourDStemWorkerResponse,
} from '../docs-astro/src/scripts/four-d-stem-types.ts'

const evidence: FourDStemEvidenceSnapshot = Object.freeze({
  sourceBytes: 4,
  logicalReads: 1,
  logicalBytes: 4,
  uniquePrimarySourceBytes: 4,
  logicalRanges: Object.freeze([Object.freeze({ start: 0, end: 4 })]),
  abortedReads: 0,
  physicalTransfers: 0,
  transferredBytes: 0,
  coalescedConsumers: 0,
  cacheHits: 0,
  cacheMisses: 1,
  cacheEvictions: 0,
  retainedCacheBytes: 0,
  decodedBlocks: 1,
  cacheAdmissions: 1,
  sourceRetainedBytes: 0,
  derivedRetainedBytes: 0,
  cancellations: 0,
  liveManagedBytes: 0,
  peakManagedBytes: 4,
  firstTileMilliseconds: 1,
  activeOperation: 'open · complete',
  provider: 'reference@1',
  timeline: Object.freeze([
    Object.freeze({ timeMicroseconds: 1, type: 'operation', label: 'open' }),
  ]),
})

const view = Object.freeze({
  width: 1,
  height: 1,
  pixels: Uint8ClampedArray.of(1, 2, 3, 255),
  range: Object.freeze([0, 1] as const),
})

const opened: FourDStemWorkerResponse = Object.freeze({
  version: 1,
  type: 'opened',
  sequence: 2,
  name: 'fixture.mib',
  reader: 'purejsimage/mib@1.0.0',
  sampleType: 'uint16',
  scanShape: Object.freeze([1, 1] as const),
  detectorShape: Object.freeze([1, 1] as const),
  roles: Object.freeze({
    navigationX: 'scanX',
    navigationY: 'scanY',
    detectorX: 'kx',
    detectorY: 'ky',
  }),
  cursor: Object.freeze([0, 0] as const),
  navigation: view,
  diffraction: view,
  evidence,
})

describe('4D-STEM worker protocol', () => {
  it('validates requests from unknown data', () => {
    expect(isFourDStemWorkerRequest({ version: 1, type: 'open-fixture', sequence: 1 })).toBe(true)
    expect(isFourDStemWorkerRequest({ version: 1, type: 'cursor', sequence: 2 })).toBe(false)
    expect(
      isFourDStemWorkerRequest({
        version: 1,
        type: 'detector-roi',
        sequence: 3,
        reduction: 'sum',
        roi: { kind: 'annulus', x: 1, y: 1, innerRadius: 2, outerRadius: 1 },
      }),
    ).toBe(false)
    expect(isFourDStemWorkerRequest({ version: 2, type: 'close', sequence: 4 })).toBe(false)
  })

  it('validates complete responses before the page reads nested fields', () => {
    expect(isFourDStemWorkerResponse(opened)).toBe(true)
    expect(isFourDStemWorkerResponse({ ...opened, navigation: undefined })).toBe(false)
    expect(
      isFourDStemWorkerResponse({
        ...opened,
        navigation: { ...view, pixels: Uint8ClampedArray.of(1) },
      }),
    ).toBe(false)
    expect(isFourDStemWorkerResponse({ version: 1, type: 'opened', sequence: 2 })).toBe(false)
    expect(isFourDStemWorkerResponse({ version: 1, type: 'closed', sequence: -1 })).toBe(false)
  })

  it('rejects a response as soon as a newer request has been issued', () => {
    expect(isCurrentFourDStemWorkerResponseSequence(4, 5)).toBe(false)
    expect(isCurrentFourDStemWorkerResponseSequence(5, 5)).toBe(true)
  })
})
