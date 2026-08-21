import type { GeoRasterDataset } from 'purejsimage/geo'
import { HttpRangeSource } from 'purejsimage/geo/browser'
import { createGeoTiffReader } from 'purejsimage/geo/readers/geotiff'
import { openGeoZarrHttp } from 'purejsimage/geo/readers/geozarr'

const consume = (_dataset: GeoRasterDataset): void => {}

export const openCogShowcase = async (url: string, signal: AbortSignal): Promise<void> => {
  const source = await HttpRangeSource.open(url, {
    allowHeadSizeFallback: true,
    openSignal: signal,
    lifetimeSignal: signal,
    maxCacheBytes: 4 * 1_024 * 1_024,
  })
  if (source === undefined) throw new Error('COG not found')
  const reader = createGeoTiffReader({ limits: { maxInputBytes: 256 * 1_024 * 1_024 } })
  const document = await reader.open({ primary: { id: 'cog', source }, signal })
  try {
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error('COG dataset missing')
    consume(await document.openDataset(summary.id, { signal }))
  } finally {
    await document.close?.()
  }
}

export const openGeoZarrShowcase = async (url: string, signal: AbortSignal): Promise<void> => {
  const document = await openGeoZarrHttp(url, {
    signal,
    limits: { maxRegionBytes: 8 * 1_024 * 1_024 },
  })
  try {
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error('GeoZarr dataset missing')
    consume(await document.openDataset(summary.id, { signal }))
  } finally {
    await document.close?.()
  }
}
