import type {
  ScientificCompetitorEngine,
  ScientificCompetitorFamily,
  ScientificCompetitorWorkload,
} from './competitor-types.ts'

const tiff: ScientificCompetitorFamily = 'tiff-whole-slide'
const hdf5: ScientificCompetitorFamily = 'hdf5-emd'
const medical: ScientificCompetitorFamily = 'medical-volumetric'
const array: ScientificCompetitorFamily = 'array-interchange'

export const scientificCompetitorWorkloads: readonly ScientificCompetitorWorkload[] = Object.freeze(
  [
    {
      id: 'tiff-metadata',
      title: 'TIFF metadata open',
      family: tiff,
      fixtureId: 'ordinary-tiff',
      operation: 'metadata',
      representative: false,
    },
    {
      id: 'tiff-window',
      title: 'TIFF selected native window',
      family: tiff,
      fixtureId: 'ordinary-tiff',
      operation: 'selected',
      representative: true,
      expectedShape: [64, 48],
    },
    {
      id: 'tiff-random-windows',
      title: 'Whole-slide random windows',
      family: tiff,
      fixtureId: 'aperio-svs',
      operation: 'random-windows',
      representative: true,
    },
    {
      id: 'tiff-bigtiff-window',
      title: 'BigTIFF selected native window',
      family: tiff,
      fixtureId: 'tiff-bigtiff',
      operation: 'selected',
      representative: true,
      expectedShape: [64, 48],
    },
    {
      id: 'tiff-full-decode',
      title: 'TIFF full native decode',
      family: tiff,
      fixtureId: 'ordinary-tiff',
      operation: 'full',
      representative: false,
    },
    {
      id: 'hdf5-hierarchy',
      title: 'HDF5 hierarchy open',
      family: hdf5,
      fixtureId: 'hdf5-layout',
      operation: 'hierarchy',
      representative: false,
    },
    {
      id: 'hdf5-contiguous-full',
      title: 'HDF5 contiguous full dataset',
      family: hdf5,
      fixtureId: 'hdf5-layout',
      operation: 'full',
      datasetPath: 'dset_contiguous',
      representative: true,
      expectedShape: [40, 20],
      expectedNativeSampleType: 'int32',
    },
    {
      id: 'hdf5-contiguous-selected',
      title: 'HDF5 contiguous selected hyperslab',
      family: hdf5,
      fixtureId: 'hdf5-layout',
      operation: 'selected',
      datasetPath: 'dset_contiguous',
      representative: true,
      expectedShape: [2, 3],
      expectedNativeSampleType: 'int32',
    },
    {
      id: 'hdf5-chunked-full',
      title: 'HDF5 chunked full dataset',
      family: hdf5,
      fixtureId: 'hdf5-layout',
      operation: 'full',
      datasetPath: 'dset_chunk',
      representative: true,
      expectedShape: [40, 20],
      expectedNativeSampleType: 'int32',
    },
    {
      id: 'hdf5-chunked-selected',
      title: 'HDF5 chunked selected hyperslab',
      family: hdf5,
      fixtureId: 'hdf5-layout',
      operation: 'selected',
      datasetPath: 'dset_chunk',
      representative: true,
      expectedShape: [2, 3],
      expectedNativeSampleType: 'int32',
    },
    {
      id: 'nifti-header',
      title: 'NIfTI header and spatial metadata',
      family: medical,
      fixtureId: 'nifti',
      operation: 'metadata',
      representative: false,
      expectedShape: [2, 2],
    },
    {
      id: 'nifti-full',
      title: 'NIfTI full native image',
      family: medical,
      fixtureId: 'nifti',
      operation: 'full',
      representative: true,
      expectedShape: [2, 2],
      expectedNativeSampleType: 'int16',
    },
    {
      id: 'nifti-gzip-full',
      title: 'gzip NIfTI full native image',
      family: medical,
      fixtureId: 'nifti-gzip',
      operation: 'full',
      representative: true,
      expectedShape: [2, 2],
      expectedNativeSampleType: 'int16',
    },
    {
      id: 'nifti-selected-slice',
      title: 'NIfTI selected slice after input materialization',
      family: medical,
      fixtureId: 'nifti',
      operation: 'selected',
      representative: true,
      expectedShape: [2, 2],
      expectedNativeSampleType: 'int16',
    },
    {
      id: 'nrrd-full',
      title: 'NRRD full native image',
      family: medical,
      fixtureId: 'nrrd-raw',
      operation: 'full',
      representative: true,
      expectedShape: [2, 2],
      expectedNativeSampleType: 'uint8',
    },
    {
      id: 'nrrd-gzip-full',
      title: 'gzip NRRD full native image',
      family: medical,
      fixtureId: 'nrrd-gzip',
      operation: 'full',
      representative: true,
      expectedShape: [2, 2],
      expectedNativeSampleType: 'uint8',
    },
    {
      id: 'meta-image-mha-full',
      title: 'MetaImage MHA full native image',
      family: medical,
      fixtureId: 'meta-image-mha',
      operation: 'full',
      representative: true,
      expectedShape: [2, 2],
      expectedNativeSampleType: 'uint8',
    },
    {
      id: 'meta-image-mhd-full',
      title: 'MetaImage MHD detached native image',
      family: medical,
      fixtureId: 'meta-image-mhd',
      operation: 'full',
      representative: true,
      expectedShape: [2, 1],
      expectedNativeSampleType: 'uint16',
    },
    {
      id: 'mrc-full',
      title: 'MRC full native volume',
      family: medical,
      fixtureId: 'mrc-volume',
      operation: 'full',
      representative: true,
      expectedShape: [2, 2, 1],
      expectedNativeSampleType: 'int16',
    },
    {
      id: 'medical-tiff-full',
      title: 'ITK medical TIFF full native image',
      family: medical,
      fixtureId: 'ordinary-tiff',
      operation: 'full',
      representative: false,
    },
    {
      id: 'npy-c-header',
      title: 'NPY C-order header',
      family: array,
      fixtureId: 'npy-c-order',
      operation: 'metadata',
      representative: false,
      expectedShape: [2, 3],
      expectedNativeSampleType: 'uint16',
    },
    {
      id: 'npy-c-full',
      title: 'NPY C-order full native array',
      family: array,
      fixtureId: 'npy-c-order',
      operation: 'full',
      representative: true,
      expectedShape: [2, 3],
      expectedNativeSampleType: 'uint16',
    },
    {
      id: 'npy-fortran-full',
      title: 'NPY Fortran-order full native array',
      family: array,
      fixtureId: 'npy-fortran-order',
      operation: 'full',
      representative: true,
      expectedShape: [3, 2],
      expectedNativeSampleType: 'uint16',
    },
  ],
)

const allWorkloadIds = scientificCompetitorWorkloads.map(({ id }) => id)

const notSupported = (
  supported: readonly string[],
  reason: string,
): Readonly<Record<string, string>> => {
  const supportedSet = new Set(supported)
  return Object.freeze(
    Object.fromEntries(
      allWorkloadIds.filter((id) => !supportedSet.has(id)).map((id) => [id, reason]),
    ),
  )
}

const makeEngine = (options: {
  readonly id: string
  readonly packageName: string
  readonly packageNames?: readonly string[]
  readonly packageVersion: string
  readonly implementationClass: 'pure-javascript' | 'webassembly'
  readonly environment: 'Node' | 'browser' | 'both'
  readonly inputModel:
    | 'ImageSource'
    | 'file path'
    | 'ArrayBuffer'
    | 'complete Uint8Array'
    | 'virtual filesystem'
  readonly lazyOrSelectedReads: boolean
  readonly copiesCompleteInputBeforeOpen: boolean
  readonly supportedWorkloadIds: readonly string[]
  readonly unsupportedReason: string
}): ScientificCompetitorEngine => {
  const supportedWorkloadIds = Object.freeze([...options.supportedWorkloadIds])
  return Object.freeze({
    ...options,
    supportedWorkloadIds,
    unsupportedReasons: notSupported(supportedWorkloadIds, options.unsupportedReason),
  })
}

export const scientificCompetitorEngines: readonly ScientificCompetitorEngine[] = Object.freeze([
  makeEngine({
    id: 'geotiff',
    packageName: 'geotiff',
    packageVersion: '3.0.5',
    implementationClass: 'pure-javascript',
    environment: 'both',
    inputModel: 'ImageSource',
    lazyOrSelectedReads: true,
    copiesCompleteInputBeforeOpen: false,
    supportedWorkloadIds: [
      'tiff-metadata',
      'tiff-window',
      'tiff-random-windows',
      'tiff-bigtiff-window',
    ],
    unsupportedReason:
      'GeoTIFF is measured only through its public TIFF/ImageSource path; no full-decode claim is made.',
  }),
  makeEngine({
    id: 'tiff',
    packageName: 'tiff',
    packageVersion: '7.1.3',
    implementationClass: 'pure-javascript',
    environment: 'both',
    inputModel: 'complete Uint8Array',
    lazyOrSelectedReads: false,
    copiesCompleteInputBeforeOpen: false,
    supportedWorkloadIds: ['tiff-full-decode'],
    unsupportedReason:
      'The public tiff package is a complete-buffer decoder without a selected-window API.',
  }),
  makeEngine({
    id: 'utif2',
    packageName: 'utif2',
    packageVersion: '4.1.0',
    implementationClass: 'pure-javascript',
    environment: 'both',
    inputModel: 'ArrayBuffer',
    lazyOrSelectedReads: false,
    copiesCompleteInputBeforeOpen: false,
    supportedWorkloadIds: ['tiff-full-decode'],
    unsupportedReason:
      'UTIF2 is measured only as a complete native TIFF decode; RGBA conversion is excluded.',
  }),
  makeEngine({
    id: 'image-js',
    packageName: 'image-js',
    packageVersion: '1.7.0',
    implementationClass: 'pure-javascript',
    environment: 'both',
    inputModel: 'complete Uint8Array',
    lazyOrSelectedReads: false,
    copiesCompleteInputBeforeOpen: false,
    supportedWorkloadIds: ['tiff-full-decode'],
    unsupportedReason:
      'image-js exposes a complete decoded Image; selected TIFF reads and native volumetric reads are not claimed.',
  }),
  makeEngine({
    id: 'nifti-reader-js',
    packageName: 'nifti-reader-js',
    packageVersion: '0.8.0',
    implementationClass: 'pure-javascript',
    environment: 'both',
    inputModel: 'ArrayBuffer',
    lazyOrSelectedReads: false,
    copiesCompleteInputBeforeOpen: true,
    supportedWorkloadIds: ['nifti-header', 'nifti-full', 'nifti-gzip-full', 'nifti-selected-slice'],
    unsupportedReason:
      'nifti-reader-js accepts a complete ArrayBuffer and has no lazy selected-slice source API.',
  }),
  makeEngine({
    id: 'npyjs',
    packageName: 'npyjs',
    packageVersion: '1.2.0',
    implementationClass: 'pure-javascript',
    environment: 'both',
    inputModel: 'ArrayBuffer',
    lazyOrSelectedReads: false,
    copiesCompleteInputBeforeOpen: true,
    supportedWorkloadIds: ['npy-c-header', 'npy-c-full', 'npy-fortran-full'],
    unsupportedReason:
      'npyjs exposes parse/load of a complete NPY buffer; selected array reads are not public.',
  }),
  makeEngine({
    id: 'jsfive',
    packageName: 'jsfive',
    packageVersion: '0.4.0',
    implementationClass: 'pure-javascript',
    environment: 'both',
    inputModel: 'ArrayBuffer',
    lazyOrSelectedReads: false,
    copiesCompleteInputBeforeOpen: true,
    supportedWorkloadIds: ['hdf5-hierarchy', 'hdf5-contiguous-full', 'hdf5-chunked-full'],
    unsupportedReason:
      'jsfive opens a complete ArrayBuffer and its public Dataset value path materializes full datasets; hyperslabs are not claimed.',
  }),
  makeEngine({
    id: 'h5wasm',
    packageName: 'h5wasm',
    packageVersion: '0.10.3',
    implementationClass: 'webassembly',
    environment: 'both',
    inputModel: 'virtual filesystem',
    lazyOrSelectedReads: true,
    copiesCompleteInputBeforeOpen: true,
    supportedWorkloadIds: [
      'hdf5-hierarchy',
      'hdf5-contiguous-full',
      'hdf5-contiguous-selected',
      'hdf5-chunked-full',
      'hdf5-chunked-selected',
    ],
    unsupportedReason:
      'h5wasm is measured only on HDF5 through its explicit Emscripten virtual filesystem bridge.',
  }),
  makeEngine({
    id: 'itk-wasm-image-io',
    packageName: '@itk-wasm/image-io',
    packageVersion: '1.6.1',
    implementationClass: 'webassembly',
    environment: 'both',
    inputModel: 'file path',
    lazyOrSelectedReads: false,
    copiesCompleteInputBeforeOpen: true,
    supportedWorkloadIds: [
      'nifti-header',
      'nifti-full',
      'nifti-gzip-full',
      'nifti-selected-slice',
      'nrrd-full',
      'nrrd-gzip-full',
      'meta-image-mha-full',
      'meta-image-mhd-full',
      'mrc-full',
      'medical-tiff-full',
    ],
    unsupportedReason:
      'Only formats accepted by @itk-wasm/image-io public readImage/readImageNode are claimed; no conversion glue is used.',
  }),
])

export const scientificCompetitorEngineById = new Map(
  scientificCompetitorEngines.map((engine) => [engine.id, engine]),
)

export const scientificCompetitorWorkloadById = new Map(
  scientificCompetitorWorkloads.map((workload) => [workload.id, workload]),
)
