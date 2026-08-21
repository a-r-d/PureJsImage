const encoder = new TextEncoder()

export interface GeoShowcaseFixtureResource {
  readonly name: string
  readonly bytes: Uint8Array
}

const convention = {
  proj: {
    schema_url:
      'https://raw.githubusercontent.com/zarr-conventions/proj/refs/tags/v0.1/schema.json',
    spec_url: 'https://github.com/zarr-conventions/proj/blob/v0.1/README.md',
    uuid: 'f17cb550-5864-4468-aeb7-f3180cfb622f',
    name: 'proj',
    description: 'Coordinate reference system information for geospatial data',
  },
  spatial: {
    schema_url:
      'https://raw.githubusercontent.com/zarr-conventions/spatial/refs/tags/v0.1/schema.json',
    spec_url: 'https://github.com/zarr-conventions/spatial/blob/v0.1/README.md',
    uuid: '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
    name: 'spatial',
    description: 'Spatial coordinate information',
  },
  multiscales: {
    schema_url:
      'https://raw.githubusercontent.com/zarr-conventions/multiscales/refs/tags/v0.1/schema.json',
    spec_url: 'https://github.com/zarr-conventions/multiscales/blob/v0.1/README.md',
    uuid: 'd35379db-88df-4056-af3a-620245f8e347',
    name: 'multiscales',
    description: 'Multiscale layout of zarr datasets',
  },
} as const

const metadata = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value))

const arrayMetadata = (
  shape: readonly number[],
  chunkShape: readonly number[],
  affine: readonly number[],
): Uint8Array =>
  metadata({
    zarr_format: 3,
    node_type: 'array',
    shape,
    data_type: 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: chunkShape } },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    fill_value: 0,
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    dimension_names: ['time', 'band', 'Y', 'X'],
    attributes: {
      zarr_conventions: [convention.proj, convention.spatial],
      'proj:code': 'EPSG:32632',
      'spatial:dimensions': ['Y', 'X'],
      'spatial:transform': affine,
      'spatial:registration': 'pixel',
      band_names: ['red', 'green', 'nir'],
      time_values: ['2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z'],
      units: 'reflectance index',
    },
  })

const sample = (time: number, band: number, x: number, y: number): number => {
  const seasonal = time * 24
  if (band === 0) return 25 + seasonal + ((x * 5 + y * 2) % 150)
  if (band === 1) return 18 + seasonal + ((x * 2 + y * 6) % 150)
  return 35 + seasonal + ((x * 7 + y * 3) % 180)
}

const chunks = (
  prefix: string,
  width: number,
  height: number,
  chunkWidth: number,
  chunkHeight: number,
  scale: number,
): GeoShowcaseFixtureResource[] => {
  const output: GeoShowcaseFixtureResource[] = []
  for (let time = 0; time < 2; time += 1) {
    for (let band = 0; band < 3; band += 1) {
      for (let row = 0; row < Math.ceil(height / chunkHeight); row += 1) {
        for (let column = 0; column < Math.ceil(width / chunkWidth); column += 1) {
          const values = new Uint8Array(chunkWidth * chunkHeight)
          for (let y = 0; y < chunkHeight; y += 1) {
            for (let x = 0; x < chunkWidth; x += 1) {
              const globalX = (column * chunkWidth + x) * scale
              const globalY = (row * chunkHeight + y) * scale
              values[y * chunkWidth + x] = sample(time, band, globalX, globalY)
            }
          }
          output.push({ name: `${prefix}/c/${time}/${band}/${row}/${column}`, bytes: values })
        }
      }
    }
  }
  return output
}

export const geoShowcaseZarrResources = (): readonly GeoShowcaseFixtureResource[] => {
  const fineAffine = [30, 0, 500_000, 0, -30, 4_600_000] as const
  const coarseAffine = [60, 0, 500_000, 0, -60, 4_600_000] as const
  const root = metadata({
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      title: 'Deterministic time and band GeoZarr cube',
      zarr_conventions: [convention.proj, convention.spatial, convention.multiscales],
      'proj:code': 'EPSG:32632',
      'spatial:dimensions': ['Y', 'X'],
      'spatial:transform': fineAffine,
      'spatial:registration': 'pixel',
      multiscales: {
        resampling_method: 'average',
        layout: [
          { asset: 'fine', 'spatial:transform': fineAffine },
          {
            asset: 'coarse',
            derived_from: 'fine',
            transform: { scale: [2, 2], translation: [0, 0] },
            'spatial:transform': coarseAffine,
          },
        ],
      },
    },
  })
  return Object.freeze([
    { name: 'zarr.json', bytes: root },
    { name: 'fine/zarr.json', bytes: arrayMetadata([2, 3, 24, 32], [1, 1, 8, 8], fineAffine) },
    {
      name: 'coarse/zarr.json',
      bytes: arrayMetadata([2, 3, 12, 16], [1, 1, 6, 8], coarseAffine),
    },
    ...chunks('fine', 32, 24, 8, 8, 1),
    ...chunks('coarse', 16, 12, 8, 6, 2),
  ])
}
