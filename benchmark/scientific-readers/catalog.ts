import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  generatedScientificFixtures,
  type GeneratedScientificFixture,
} from './generated-fixtures.ts'
import type { PreparedFixture, PreparedResource } from './types.ts'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = dirname(dirname(benchmarkDirectory))
const generatedDirectory = join(benchmarkDirectory, '.tmp', 'scientific-readers-fixtures')

interface ResourceDefinition {
  readonly id: string
  readonly name: string
  readonly relativePath: string
}

interface FixtureDefinition {
  readonly id: string
  readonly realResources?: readonly ResourceDefinition[]
  readonly generatedKey?: keyof typeof generatedScientificFixtures
  readonly provenance: string
  readonly supportBoundary: string
  readonly expectedOracle: string
}

const resource = (id: string, relativePath: string): ResourceDefinition => ({
  id,
  name: relativePath.split('/').at(-1) ?? relativePath,
  relativePath,
})

const definitions: readonly FixtureDefinition[] = [
  {
    id: 'gsf-surface',
    realResources: [
      resource('primary', 'docs-astro/public/demo-data/scientific/synthetic-afm.gsf'),
    ],
    generatedKey: 'gsf-generated',
    provenance: 'Repository-generated Gwyddion Simple Field demo surface.',
    supportBoundary: 'Single-resource GSF numeric surface.',
    expectedOracle: 'Descriptor and first selected surface samples must be finite float64 values.',
  },
  {
    id: 'nanonis-afm',
    realResources: [
      resource('primary', 'tests/fixtures/scientific-surface/nanonis-afm-generic4.sxm'),
    ],
    provenance: 'Pinned FAIRmat-NFDI pynxtools-spm Generic 4 AFM fixture.',
    supportBoundary: 'Nanonis SXM maps exposed as labeled planes.',
    expectedOracle: 'First dataset exposes calibrated x/y axes and a readable bounded plane.',
  },
  {
    id: 'igor-wave',
    realResources: [resource('primary', 'tests/fixtures/scientific-surface/asylum-afm-v5.ibw')],
    provenance: 'Pinned AFMReader Asylum Research Igor binary wave fixture.',
    supportBoundary: 'Igor binary waves of supported rank and numeric sample types.',
    expectedOracle: 'First dataset exposes at least two axes and a readable plane.',
  },
  {
    id: 'digital-surf',
    realResources: [
      resource('primary', 'tests/fixtures/scientific-surface/digital-surf-compressed.sur'),
    ],
    provenance: 'Pinned RosettaSciIO compressed Digital Surf test surface.',
    supportBoundary: 'Digital Surf map object with bounded compressed decode.',
    expectedOracle: 'First surface descriptor is calibrated and a bounded plane is readable.',
  },
  {
    id: 'x3p-surface',
    realResources: [resource('primary', 'tests/fixtures/scientific-surface/iso5436-sample1.x3p')],
    provenance: 'Pinned OpenFMC ISO 5436 sample archive.',
    supportBoundary: 'X3P ZIP surface with main.xml and binary data member.',
    expectedOracle: 'First dataset exposes a 4x4 calibrated plane.',
  },
  {
    id: 'envi-hyperspectral',
    realResources: [
      resource('primary', 'docs-astro/public/demo-data/scientific/synthetic-hyperspectral.hdr'),
      resource('data', 'docs-astro/public/demo-data/scientific/synthetic-hyperspectral.bin'),
    ],
    generatedKey: 'envi-generated',
    provenance: 'Repository-generated ENVI hyperspectral demo header and binary pair.',
    supportBoundary: 'ENVI header/data companion pair with bounded band selection.',
    expectedOracle: 'Header and binary resolve as one dataset with a readable band plane.',
  },
  {
    id: 'fits-cube',
    realResources: [
      resource('primary', 'docs-astro/public/demo-data/scientific/synthetic-cube.fits'),
    ],
    provenance: 'Repository-generated FITS cube used by the scientific demo.',
    supportBoundary: 'FITS image HDU numeric cube.',
    expectedOracle: 'Primary image dataset exposes x/y axes and a readable plane.',
  },
  {
    id: 'mrc-volume',
    generatedKey: 'mrc-generated',
    provenance: 'Deterministic first-party MRC benchmark fixture.',
    supportBoundary: 'MRC mode-1 little-endian 2D volume with MAP signature.',
    expectedOracle: '2x2 int16 plane values are finite and metadata includes cell dimensions.',
  },
  {
    id: 'cbf-frame',
    generatedKey: 'cbf-generated',
    provenance: 'Deterministic first-party CBF byte-offset benchmark fixture.',
    supportBoundary: 'CBF signed 32-bit little-endian byte-offset detector frame.',
    expectedOracle: '2x2 detector plane decodes to four finite samples.',
  },
  {
    id: 'png-image',
    realResources: [resource('primary', 'benchmark/corpus/files/pngsuite-palette-8.png')],
    provenance: 'Pinned PNG Suite palette sample in the repository corpus.',
    supportBoundary: 'Public PNG scientific-reader adapter backed by the image codec.',
    expectedOracle: 'Image codec adapter exposes a uint8 plane.',
  },
  {
    id: 'jpeg-image',
    realResources: [resource('primary', 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-rgb.jpg')],
    provenance: 'Pinned Web Platform Tests MozJPEG RGB sample.',
    supportBoundary: 'Public JPEG scientific-reader adapter backed by the image codec.',
    expectedOracle: 'Image codec adapter exposes a uint8 plane.',
  },
  {
    id: 'webp-image',
    realResources: [resource('primary', 'benchmark/corpus/files/webp-lossless-tux-386x395.webp')],
    provenance: 'Pinned WebP lossless image corpus sample.',
    supportBoundary: 'Public WebP scientific-reader adapter backed by the image codec.',
    expectedOracle: 'Image codec adapter exposes a uint8 plane.',
  },
  {
    id: 'bmp-image',
    realResources: [resource('primary', 'benchmark/corpus/files/bmpsuite-rgb24.bmp')],
    provenance: 'Pinned BMP Suite RGB24 sample.',
    supportBoundary: 'Public BMP scientific-reader adapter backed by the image codec.',
    expectedOracle: 'Image codec adapter exposes a uint8 plane.',
  },
  {
    id: 'jp2-image',
    realResources: [resource('primary', 'benchmark/corpus/files/jp2/openjpeg-lossless-rgb16.jp2')],
    provenance: 'Pinned OpenJPEG lossless RGB16 JPEG 2000 sample.',
    supportBoundary: 'Public JPEG 2000 scientific-reader adapter backed by the image codec.',
    expectedOracle: 'Image codec adapter exposes a uint8 plane after canonical decode.',
  },
  {
    id: 'ordinary-tiff',
    realResources: [resource('primary', 'benchmark/corpus/files/libtiff-rgb-3c-8b.tiff')],
    provenance: 'Pinned LibTIFF RGB sample.',
    supportBoundary: 'Ordinary TIFF image directory and bounded region reads.',
    expectedOracle: 'First TIFF dataset exposes x/y axes and a readable region.',
  },
  {
    id: 'ome-tiff',
    generatedKey: 'ome-tiff-generated',
    provenance: 'Deterministic first-party OME-XML TIFF benchmark fixture.',
    supportBoundary: 'OME-TIFF single-plane XYZCT image with embedded XML.',
    expectedOracle: 'OME metadata selects the OME reader and exposes x/y/z/channel/time axes.',
  },
  {
    id: 'aperio-svs',
    realResources: [resource('primary', 'tests/fixtures/aperio-cmu-1-small-region.svs')],
    provenance: 'Pinned Aperio CMU-1 small-region whole-slide fixture.',
    supportBoundary: 'Aperio SVS tiled pyramid with direct tile/range reads.',
    expectedOracle:
      'Pyramid dataset exposes a bounded readable region without full-source materialization.',
  },
  {
    id: 'digital-micrograph-2d',
    realResources: [resource('primary', 'benchmark/corpus/files/digital-micrograph/test-10.dm4')],
    generatedKey: 'digital-micrograph-generated',
    provenance:
      'Pinned RosettaSciIO DigitalMicrograph 2D test fixture; generated fallback is deterministic.',
    supportBoundary: 'DM3/DM4 numeric 2D image datasets.',
    expectedOracle: 'First supported image dataset exposes a readable 2D plane.',
  },
  {
    id: 'digital-micrograph-4d-stem',
    generatedKey: 'digital-micrograph-4d-generated',
    provenance: 'Deterministic first-party DigitalMicrograph 4D-STEM fixture.',
    supportBoundary: 'Explicit diffraction-image/Data-Order-Swapped 4D STEM semantics.',
    expectedOracle: 'When the fixture is 4D STEM, kx/ky is readable with fixed scan axes.',
  },
  {
    id: 'tia-ser-image',
    realResources: [
      resource('primary', 'benchmark/corpus/files/tia-ser/old/64x64x5_TEM_preview_1.ser'),
    ],
    generatedKey: 'tia-ser-image-generated',
    provenance: 'Pinned RosettaSciIO TIA SER image fixture; generated fallback is deterministic.',
    supportBoundary: 'TIA SER image elements exposed as calibrated planes.',
    expectedOracle: 'Image dataset exposes x/y with one fixed element index.',
  },
  {
    id: 'tia-ser-spectrum',
    realResources: [
      resource('primary', 'benchmark/corpus/files/tia-ser/old/16x16-spectrum_image-5x5x1024_1.ser'),
    ],
    generatedKey: 'tia-ser-spectrum-generated',
    provenance:
      'Pinned RosettaSciIO TIA SER spectrum-image fixture; generated fallback is deterministic.',
    supportBoundary: 'TIA SER spectrum image with energy series reads.',
    expectedOracle: 'Spectra dataset exposes x/y/energy and a bounded energy series.',
  },
  {
    id: 'tia-emi',
    realResources: [
      resource('primary', 'benchmark/corpus/files/tia-emi/old/64x64_TEM_images_acquire.emi'),
      resource('ser-1', 'benchmark/corpus/files/tia-emi/old/64x64_TEM_images_acquire_1.ser'),
    ],
    generatedKey: 'tia-emi-generated',
    provenance:
      'Pinned RosettaSciIO TIA EMI/SER companion set; generated fallback is deterministic.',
    supportBoundary: 'EMI metadata with numbered SER companion resolution.',
    expectedOracle:
      'At least one ser-* dataset opens and retains EMI metadata/calibration evidence.',
  },
  {
    id: 'ncem-emd',
    realResources: [resource('primary', 'benchmark/corpus/files/ncem-emd/example_image.emd')],
    generatedKey: 'ncem-generated',
    provenance: 'Pinned RosettaSciIO NCEM EMD image fixture; generated fallback is deterministic.',
    supportBoundary: 'NCEM EMD HDF5 image/spectrum datasets with bounded contiguous reads.',
    expectedOracle: 'First image dataset exposes a readable plane or series according to rank.',
  },
  {
    id: 'velox-emd',
    realResources: [
      resource('primary', 'benchmark/corpus/files/velox-emd/fei_example_tem_stack.emd'),
    ],
    generatedKey: 'velox-generated',
    provenance: 'Pinned RosettaSciIO Velox EMD image fixture; generated fallback is deterministic.',
    supportBoundary: 'Velox EMD image hierarchy with HDF5 metadata columns.',
    expectedOracle: 'First image dataset exposes a readable plane.',
  },
  {
    id: 'velox-emd-complex',
    realResources: [
      resource('primary', 'benchmark/corpus/files/velox-emd/fei_example_complex_fft.emd'),
    ],
    generatedKey: 'velox-complex-generated',
    provenance:
      'Pinned RosettaSciIO Velox complex FFT fixture; generated fallback is deterministic.',
    supportBoundary: 'Velox EMD complex two-component image samples.',
    expectedOracle: 'Complex dataset preserves two output components and a readable plane.',
  },
  {
    id: 'rpl-raw',
    realResources: [
      resource('primary', 'benchmark/corpus/files/scientific-interchange/sample.rpl'),
      resource('raw', 'benchmark/corpus/files/scientific-interchange/sample.raw'),
    ],
    generatedKey: 'rpl-generated',
    provenance:
      'Pinned RosettaSciIO RPL/RAW interchange pair; generated fallback is deterministic.',
    supportBoundary: 'RPL vector-record header with RAW companion and calibrated depth axis.',
    expectedOracle: 'Depth-fixed x/y plane is readable and the companion is resolved.',
  },
  {
    id: 'emsa-spectrum',
    realResources: [
      resource('primary', 'benchmark/corpus/files/scientific-interchange/compliance.msa'),
    ],
    generatedKey: 'emsa-generated',
    provenance:
      'Pinned ISO 22029 EMSA/MAS compliance spectrum; generated fallback is deterministic.',
    supportBoundary: 'EMSA Y/XY spectra exposed through bounded series reads.',
    expectedOracle: 'Spectral axis calibration is present and a bounded series is readable.',
  },
  {
    id: 'nrrd-raw',
    generatedKey: 'nrrd-raw-generated',
    provenance: 'Deterministic first-party attached NRRD benchmark fixture.',
    supportBoundary: 'NRRD raw encoding with a 2D uchar payload.',
    expectedOracle: '2x2 raw NRRD plane is readable.',
  },
  {
    id: 'nrrd-gzip',
    generatedKey: 'nrrd-gzip-generated',
    provenance: 'Deterministic first-party gzip-encoded NRRD benchmark fixture.',
    supportBoundary: 'NRRD gzip encoding with bounded decompression.',
    expectedOracle: '2x2 gzip NRRD plane is readable.',
  },
  {
    id: 'meta-image-mha',
    generatedKey: 'mha-generated',
    provenance: 'Deterministic first-party MetaImage local-payload fixture.',
    supportBoundary: 'MHA LOCAL payload with 2D uchar data.',
    expectedOracle: '2x2 local MetaImage plane is readable.',
  },
  {
    id: 'meta-image-mhd',
    generatedKey: 'mhd-generated',
    provenance: 'Deterministic first-party MetaImage detached-payload fixture.',
    supportBoundary: 'MHD header with an external RAW companion.',
    expectedOracle: 'Detached 2x1 uint16 plane resolves the RAW companion and is readable.',
  },
  {
    id: 'nifti',
    generatedKey: 'nifti-generated',
    provenance: 'Deterministic first-party NIfTI-1 benchmark fixture.',
    supportBoundary: 'NIfTI-1 little-endian scaled int16 2D image.',
    expectedOracle: 'Scaled output is readable and spatial calibration is retained.',
  },
  {
    id: 'nifti-gzip',
    generatedKey: 'nifti-gzip-generated',
    provenance: 'Deterministic first-party gzip-wrapped NIfTI benchmark fixture.',
    supportBoundary: 'Gzip-wrapped NIfTI-1 input.',
    expectedOracle: 'Gzip source opens and returns the same selected plane semantics.',
  },
  {
    id: 'npy-c-order',
    generatedKey: 'npy-c-generated',
    provenance: 'Deterministic first-party C-order NPY benchmark fixture.',
    supportBoundary: 'NPY v1 little-endian uint16 C-order array.',
    expectedOracle: 'C-order axes are preserved and a plane is readable.',
  },
  {
    id: 'npy-fortran-order',
    generatedKey: 'npy-f-generated',
    provenance: 'Deterministic first-party Fortran-order NPY benchmark fixture.',
    supportBoundary: 'NPY v1 little-endian uint16 Fortran-order array.',
    expectedOracle: 'Fortran-order axes are preserved and a plane is readable.',
  },
  {
    id: 'blockfile',
    realResources: [resource('primary', 'benchmark/corpus/files/scientific-interchange/test2.blo')],
    generatedKey: 'blockfile-generated',
    provenance:
      'Pinned RosettaSciIO Merlin blockfile fixture; generated fallback is deterministic.',
    supportBoundary: 'BLO navigation plus bounded diffraction frame reads.',
    expectedOracle: 'A fixed navigation position exposes a readable diffraction plane.',
  },
  {
    id: 'mib',
    generatedKey: 'mib-generated',
    provenance: 'Deterministic first-party Merlin MIB benchmark fixture.',
    supportBoundary: 'MIB header with a small uint8 diffraction frame.',
    expectedOracle: 'MIB frame dataset exposes a readable diffraction plane.',
  },
  {
    id: 'ebsd-ang',
    generatedKey: 'ebsd-ang-generated',
    provenance: 'Deterministic first-party EBSD ANG text benchmark fixture.',
    supportBoundary: 'EBSD ANG grid with orientation and phase columns.',
    expectedOracle: 'ANG map exposes a readable x/y plane.',
  },
  {
    id: 'ebsd-ctf',
    generatedKey: 'ebsd-ctf-generated',
    provenance: 'Deterministic first-party EBSD CTF text benchmark fixture.',
    supportBoundary: 'EBSD CTF grid with orientation and phase columns.',
    expectedOracle: 'CTF map exposes a readable x/y plane.',
  },
]

const definitionById = new Map(definitions.map((definition) => [definition.id, definition]))

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const fixtureHash = (resources: readonly PreparedResource[]): string => {
  const hash = createHash('sha256')
  for (const resource of resources) {
    hash.update(resource.id)
    hash.update(resource.name ?? '')
    hash.update(resource.sha256)
  }
  return hash.digest('hex')
}

const existingFile = async (path: string): Promise<boolean> => {
  try {
    const details = await stat(path)
    return details.isFile()
  } catch {
    return false
  }
}

const realResourcesAvailable = async (definition: FixtureDefinition): Promise<boolean> => {
  if (definition.realResources === undefined) return false
  for (const resource of definition.realResources) {
    if (!(await existingFile(join(repositoryDirectory, resource.relativePath)))) return false
  }
  return true
}

const generatedResources = async (
  definition: FixtureDefinition,
): Promise<readonly PreparedResource[]> => {
  if (definition.generatedKey === undefined) {
    throw new Error(`Fixture ${definition.id} has no generated fallback`)
  }
  const factory = generatedScientificFixtures[definition.generatedKey]
  if (factory === undefined) throw new Error(`Missing generated fixture ${definition.generatedKey}`)
  const generated: GeneratedScientificFixture = factory()
  const directory = join(generatedDirectory, definition.id)
  await mkdir(directory, { recursive: true })
  const resources: PreparedResource[] = []
  for (const [index, entry] of generated.resources.entries()) {
    const path = join(
      directory,
      `${String(index).padStart(2, '0')}-${entry.name.replaceAll('/', '_')}`,
    )
    await writeFile(path, entry.bytes)
    resources.push(
      Object.freeze({
        id: index === 0 ? 'primary' : `companion-${index}`,
        name: entry.name,
        path,
        sha256: sha256(entry.bytes),
        sizeBytes: entry.bytes.byteLength,
      }),
    )
  }
  return Object.freeze(resources)
}

const realPreparedResources = async (
  definition: FixtureDefinition,
): Promise<readonly PreparedResource[]> => {
  const entries = definition.realResources
  if (entries === undefined) throw new Error(`Fixture ${definition.id} has no real resources`)
  const resources: PreparedResource[] = []
  for (const entry of entries) {
    const path = join(repositoryDirectory, entry.relativePath)
    const bytes = await readFile(path)
    resources.push(
      Object.freeze({
        id: entry.id,
        name: entry.name,
        path,
        sha256: sha256(bytes),
        sizeBytes: bytes.byteLength,
      }),
    )
  }
  return Object.freeze(resources)
}

const generatedPayloadRanges = async (
  definition: FixtureDefinition,
  resources: readonly PreparedResource[],
): Promise<Readonly<Record<string, readonly (readonly [number, number])[]>>> => {
  if (definition.generatedKey === undefined) return Object.freeze({})
  const generated = generatedScientificFixtures[definition.generatedKey]?.()
  if (generated === undefined) return Object.freeze({})
  const ranges: Record<string, readonly (readonly [number, number])[]> = {}
  for (const resource of resources) {
    const generatedResource = generated.resources.find((entry) => entry.name === resource.name)
    const resourceRanges =
      generatedResource === undefined ? undefined : generated.payloadRanges[generatedResource.name]
    if (resourceRanges !== undefined) ranges[resource.id] = resourceRanges
  }
  return Object.freeze(ranges)
}

export const scientificFixtureDefinitions = Object.freeze(definitions)

export const prepareScientificFixture = async (fixtureId: string): Promise<PreparedFixture> => {
  const definition = definitionById.get(fixtureId)
  if (definition === undefined) throw new Error(`Unknown scientific reader fixture ${fixtureId}`)
  const useReal = await realResourcesAvailable(definition)
  const resources = useReal
    ? await realPreparedResources(definition)
    : await generatedResources(definition)
  const prepared = Object.freeze({
    id: definition.id,
    sha256: fixtureHash(resources),
    resources,
    payloadRanges: await generatedPayloadRanges(definition, resources),
    provenance: definition.provenance,
    supportBoundary: definition.supportBoundary,
    expectedOracle: definition.expectedOracle,
    representative: useReal,
  })
  return prepared
}

export const preparedFixturePath = (fixture: PreparedFixture, resourceId = 'primary'): string => {
  const resource = fixture.resources.find((entry) => entry.id === resourceId)
  if (resource === undefined) throw new Error(`Fixture ${fixture.id} has no resource ${resourceId}`)
  return resource.path
}

export const repositoryPath = (relativePath: string): string =>
  join(repositoryDirectory, relativePath)

export const scientificReaderBenchmarkDirectory = benchmarkDirectory
