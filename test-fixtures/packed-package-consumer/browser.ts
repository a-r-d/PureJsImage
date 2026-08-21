import { createAnalysisController } from 'purejsimage/analysis'
import { createTileRuntime } from 'purejsimage/analysis/runtime'
import { createImageLibrary } from 'purejsimage/browser'
import { createExtensionHost } from 'purejsimage/extensions'
import { parseGeoZarrConventionMetadata } from 'purejsimage/geo/conventions/geozarr'
import { HttpRangeSource as GeoHttpRangeSource } from 'purejsimage/geo/browser'
import { geoEnviReader } from 'purejsimage/geo/readers/envi'
import { esriAsciiGridReader } from 'purejsimage/geo/readers/esri-ascii-grid'
import { geoZarrReader, openGeoZarrHttp } from 'purejsimage/geo/readers/geozarr'
import { geoNetCdfReader } from 'purejsimage/geo/readers/netcdf'
import { srtmHgtReader } from 'purejsimage/geo/readers/srtm-hgt'
import { openWorldFileHttp, worldFileReader } from 'purejsimage/geo/readers/world-file'
import { createOperationRegistry, createValueTypeRegistry } from 'purejsimage/operations'
import { createScientificFileContext } from 'purejsimage/scientific/browser'
import { HttpRangeSource } from 'purejsimage/sources/http-range'

export const browserSurface = {
  createImageLibrary,
  createAnalysisController,
  createExtensionHost,
  createOperationRegistry,
  createScientificFileContext,
  createTileRuntime,
  createValueTypeRegistry,
  HttpRangeSource,
  GeoHttpRangeSource,
  parseGeoZarrConventionMetadata,
  geoZarrReader,
  openGeoZarrHttp,
  openWorldFileHttp,
  worldFileReader,
  geoEnviReader,
  esriAsciiGridReader,
  srtmHgtReader,
  geoNetCdfReader,
}
