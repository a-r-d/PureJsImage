import { describe, expect, it } from 'vitest'
import {
  generateTiaEmiFixture,
  generatedTiaEmiObject,
} from '../benchmark/tia-ser/generated-emi-fixture.ts'
import {
  generateTiaSerFixture,
  generatedTiaSerImageSeries,
  generatedTiaSerPointSpectrum,
} from '../benchmark/tia-ser/generated-fixture.ts'
import { createTiaEmiReader, tiaEmiReader } from '../src/scientific/readers/tia-emi.ts'
import { tiaSerReader } from '../src/scientific/readers/tia-ser.ts'
import type {
  ScientificCompanionRequest,
  ScientificOpenContext,
  ScientificResource,
} from '../src/scientific/reader.ts'
import { getScientificDatasetIdentity } from '../src/scientific/reader.ts'
import { MemorySource } from '../src/source.ts'

const resource = (id: string, name: string, bytes: Uint8Array): ScientificResource =>
  Object.freeze({ id, name, source: new MemorySource(bytes) })

const context = (
  emi: Uint8Array,
  companions: readonly ScientificResource[] = [],
  name = 'capture.emi',
): ScientificOpenContext => {
  const byName = new Map(companions.map((companion) => [companion.name, companion]))
  return Object.freeze({
    primary: resource('emi', name, emi),
    companions: Object.freeze({
      async resolve(request: Readonly<ScientificCompanionRequest>) {
        const requested = request.kind === 'relative-name' ? request.name : request.relativeName
        return requested === undefined ? undefined : byName.get(requested)
      },
    }),
  })
}

const object = (uuid: string, mode: string): string =>
  generatedTiaEmiObject({
    uuid,
    mode,
    microscope: 'Tecnai 200',
    user: 'Operator',
    acceleratingVoltageVolts: 200_000,
    acquireDate: '2015-03-04T05:06:07',
    detectorName: 'Camera 1',
    calibrationValue: 1.25,
  })

describe('TIA EMI scientific reader', () => {
  it('probes the binary signature instead of trusting the extension', async () => {
    const bytes = generateTiaEmiFixture([object('one', 'TEM Image')])
    await expect(tiaEmiReader.probe(context(bytes, [], 'capture.bin'))).resolves.toMatchObject({
      confidence: 0.99,
    })
    await expect(
      tiaEmiReader.probe(context(new Uint8Array(bytes.byteLength), [], 'capture.emi')),
    ).resolves.toMatchObject({ confidence: 0 })
  })

  it('composes multiple SER companions with bounded EMI metadata and complete identities', async () => {
    const emi = generateTiaEmiFixture([
      object('spectrum-object', 'TEM EELS'),
      object('image-object', 'TEM Image'),
    ])
    const spectrum = resource('spectrum-ser', 'capture_1.ser', generatedTiaSerPointSpectrum())
    const images = resource('image-ser', 'capture_2.ser', generatedTiaSerImageSeries())
    const document = await tiaEmiReader.open(context(emi, [spectrum, images]))
    expect(document).toMatchObject({
      format: 'FEI/Thermo TIA EMI',
      metadata: {
        objectCount: 2,
        companionCount: 2,
        unusedMetadataObjects: 0,
      },
    })
    expect(document.datasets.map(({ id }) => id)).toEqual(['ser-1/spectra', 'ser-2/images'])
    expect(document.datasets[0]?.descriptor.metadata?.['purejsimage:tiaEmi']).toMatchObject({
      metadataAvailable: true,
      objectIndex: 0,
      uuid: 'spectrum-object',
      microscopeConditions: { acceleratingVoltageVolts: 200_000 },
      experimentalDescription: [
        { label: 'Microscope', value: 'Tecnai 200' },
        { label: 'User', value: 'Operator' },
        { label: 'Mode', value: 'TEM EELS' },
      ],
      acquireInfo: [{ path: 'AcquireInfo/CameraNamePath', value: 'Camera 1' }],
      trueImageHeader: [{ path: '45', value: 1.25 }],
      calibrationMerge: { strategy: 'preserve-ser-axis-facts' },
    })
    expect(document.datasets[0]?.descriptor.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'energy',
          unit: 'eV',
          coordinates: { type: 'linear', origin: 99.5, step: 0.5 },
        }),
      ]),
    )

    for (const [datasetId, expectedResources] of [
      ['ser-1/spectra', ['emi', 'spectrum-ser']],
      ['ser-2/images', ['emi', 'image-ser']],
    ] as const) {
      const dataset = await document.openDataset(datasetId)
      expect(getScientificDatasetIdentity(dataset)?.resources.map(({ id }) => id)).toEqual(
        expectedResources,
      )
    }
    const spectrumDataset = await document.openDataset('ser-1/spectra')
    if (spectrumDataset.readSeries === undefined) throw new Error('Expected native series reads')
    const values: number[] = []
    for await (const block of spectrumDataset.readSeries({
      axisId: 'energy',
      fixedIndices: [],
      start: 1,
      length: 2,
    })) {
      values.push(...block.data)
    }
    expect(values).toEqual([0xff, 0xff, 0xff, 0xfe, 0, 0, 0, 3])
  })

  it('applies a strong reciprocal-space interpretation but preserves contradictory SER axes', async () => {
    const diffraction = generateTiaSerFixture({
      version: 544,
      dataKind: 'image',
      tagKind: 'time',
      dimensions: [],
      elements: [
        {
          calibrations: [
            { offset: 0, delta: 100, element: 0 },
            { offset: 0, delta: 200, element: 0 },
          ],
          dataType: 2,
          shape: [2, 2],
          payload: Uint8Array.of(0, 1, 0, 2, 0, 3, 0, 4),
          tag: { time: 0 },
        },
      ],
    })
    const applied = await tiaEmiReader.open(
      context(generateTiaEmiFixture([object('diffraction', 'TEM Diffraction')]), [
        resource('diffraction-ser', 'capture_1.ser', diffraction),
      ]),
    )
    expect(applied.datasets[0]?.descriptor.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'x', kind: 'reciprocal-space', unit: '1/m' }),
        expect.objectContaining({ id: 'y', kind: 'reciprocal-space', unit: '1/m' }),
      ]),
    )
    expect(applied.datasets[0]?.descriptor.metadata?.['purejsimage:tiaEmi']).toMatchObject({
      calibrationMerge: { appliedAxes: ['x', 'y'], preservedConflicts: [] },
    })

    const preserved = await tiaEmiReader.open(
      context(generateTiaEmiFixture([object('spatial', 'TEM Diffraction')]), [
        resource('spatial-ser', 'capture_1.ser', generatedTiaSerImageSeries()),
      ]),
    )
    expect(preserved.datasets[0]?.descriptor.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'x', kind: 'space', unit: 'm' }),
        expect.objectContaining({ id: 'y', kind: 'space', unit: 'm' }),
      ]),
    )
    expect(preserved.datasets[0]?.descriptor.metadata?.['purejsimage:tiaEmi']).toMatchObject({
      calibrationMerge: {
        appliedAxes: [],
        preservedConflicts: [
          expect.objectContaining({ axisId: 'x', emiInterpretation: '1/m' }),
          expect.objectContaining({ axisId: 'y', emiInterpretation: '1/m' }),
        ],
      },
    })
  })

  it('keeps later SER datasets readable when the EMI has fewer metadata objects', async () => {
    const emi = generateTiaEmiFixture([object('only-object', 'TEM Image')])
    const document = await tiaEmiReader.open(
      context(emi, [
        resource('first', 'capture_1.ser', generatedTiaSerPointSpectrum()),
        resource('second', 'capture_2.ser', generatedTiaSerImageSeries()),
      ]),
    )
    expect(document.datasets[1]?.descriptor.metadata?.['purejsimage:tiaEmi']).toEqual({
      metadataAvailable: false,
    })
    expect(document.metadata.companions).toEqual([
      expect.objectContaining({ index: 1, metadataObjectIndex: 0 }),
      expect.objectContaining({ index: 2, metadataObjectIndex: null }),
    ])
  })

  it('preserves the direct SER path independently of EMI', async () => {
    const document = await tiaSerReader.open({
      primary: resource('direct', 'direct.ser', generatedTiaSerPointSpectrum()),
    })
    expect(document.format).toBe('FEI/Thermo TIA SER')
    expect(document.datasets.map(({ id }) => id)).toEqual(['spectra'])
    expect(document.datasets[0]?.descriptor.metadata?.['purejsimage:tiaEmi']).toBeUndefined()
  })

  it('honors cancellation before primary or companion parsing', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancel TIA EMI open', 'AbortError'))
    const cancelled = context(generateTiaEmiFixture([object('cancelled', 'TEM Image')]), [
      resource('first', 'capture_1.ser', generatedTiaSerPointSpectrum()),
    ])
    await expect(
      tiaEmiReader.open({ ...cancelled, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects missing companions, malformed embedded XML, and every admission limit', async () => {
    const one = generateTiaEmiFixture([object('one', 'TEM Image')])
    await expect(tiaEmiReader.open(context(one))).rejects.toThrow('capture_1.ser is missing')
    await expect(
      tiaEmiReader.open({ primary: resource('emi', 'capture.emi', one) }),
    ).rejects.toThrow('ScientificCompanionResolver')

    const malformed = generateTiaEmiFixture(['<ObjectInfo><Uuid>bad</Uuid>'])
    await expect(
      tiaEmiReader.open(
        context(malformed, [resource('first', 'capture_1.ser', generatedTiaSerPointSpectrum())]),
      ),
    ).rejects.toThrow('truncated')

    const two = generateTiaEmiFixture([object('one', 'TEM Image'), object('two', 'TEM Image')])
    const companions = [
      resource('first', 'capture_1.ser', generatedTiaSerPointSpectrum()),
      resource('second', 'capture_2.ser', generatedTiaSerImageSeries()),
    ]
    for (const [limits, expected] of [
      [{ maxSourceBytes: one.byteLength - 1 }, 'maxSourceBytes'],
      [{ maxObjects: 1 }, 'object count'],
      [{ maxXmlBytes: 32 }, 'maxXmlBytes'],
      [{ maxXmlDepth: 2 }, 'XML depth'],
      [{ maxXmlElements: 2 }, 'XML element count'],
      [{ maxMetadataFields: 1 }, 'metadata field count'],
      [{ maxMetadataValueCharacters: 3 }, 'metadata value'],
      [{ maxCompanions: 1 }, 'companion count'],
      [{ maxDatasets: 1 }, 'dataset count'],
    ] as const) {
      const reader = createTiaEmiReader({ limits })
      await expect(reader.open(context(two, companions))).rejects.toThrow(expected)
    }
  })
})
