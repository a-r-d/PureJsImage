import { geoEnviReader } from './envi.ts'
import { esriAsciiGridReader } from './esri-ascii-grid.ts'
import { geoTiffReader } from './geotiff.ts'
import { geoZarrReader } from './geozarr/index.ts'
import type { GeoRasterReader } from './index.ts'
import { geoNetCdfReader } from './netcdf.ts'
import { srtmHgtReader } from './srtm-hgt.ts'
import { worldFileReader } from './world-file.ts'

/** Explicit geo reader set. Importing the base geo namespace does not register readers. */
export const geoReaders: readonly GeoRasterReader[] = Object.freeze([
  geoTiffReader,
  geoZarrReader,
  worldFileReader,
  geoEnviReader,
  esriAsciiGridReader,
  srtmHgtReader,
  geoNetCdfReader,
])
