export const encodeZarrJson = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

export const zarrV2GroupMetadata = (): Uint8Array => encodeZarrJson({ zarr_format: 2 })

export interface ZarrV2ArrayFixtureOptions {
  readonly shape: readonly number[]
  readonly chunks: readonly number[]
  readonly dtype?: string
  readonly fillValue?: unknown
  readonly compressor?: unknown
  readonly filters?: unknown
  readonly order?: 'C' | 'F'
  readonly separator?: '/' | '.'
}

export const zarrV2ArrayMetadata = (options: Readonly<ZarrV2ArrayFixtureOptions>): Uint8Array =>
  encodeZarrJson({
    zarr_format: 2,
    shape: options.shape,
    chunks: options.chunks,
    dtype: options.dtype ?? '|u1',
    compressor: options.compressor ?? null,
    fill_value: options.fillValue ?? 0,
    order: options.order ?? 'C',
    filters: options.filters ?? null,
    dimension_separator: options.separator ?? '/',
  })

export const zarrV3GroupMetadata = (
  attributes: Readonly<Record<string, unknown>> = {},
): Uint8Array =>
  encodeZarrJson({
    zarr_format: 3,
    node_type: 'group',
    attributes,
  })

export interface ZarrV3ArrayFixtureOptions {
  readonly shape: readonly number[]
  readonly chunkShape: readonly number[]
  readonly dataType?: string
  readonly dimensionNames?: readonly (string | null)[]
  readonly fillValue?: unknown
  readonly codecs?: readonly unknown[]
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly separator?: '/' | '.'
}

export const zarrV3ArrayMetadata = (options: Readonly<ZarrV3ArrayFixtureOptions>): Uint8Array =>
  encodeZarrJson({
    zarr_format: 3,
    node_type: 'array',
    shape: options.shape,
    data_type: options.dataType ?? 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: options.chunkShape } },
    chunk_key_encoding: {
      name: 'default',
      configuration: { separator: options.separator ?? '/' },
    },
    fill_value: options.fillValue ?? 0,
    codecs: options.codecs ?? [{ name: 'bytes', configuration: { endian: 'little' } }],
    ...(options.dimensionNames === undefined ? {} : { dimension_names: options.dimensionNames }),
    attributes: options.attributes ?? {},
  })
