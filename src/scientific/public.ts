import type { ScientificDataset } from './dataset.ts'
import type {
  ScientificPlaneMeasurement,
  ScientificPlaneMeasureOptions,
  ScientificPlaneRenderOptions,
  ScientificRenderedPlane,
} from './render.ts'
import {
  measureScientificPlane as measurePlane,
  renderScientificPlane as renderPlane,
} from './render.ts'
import type {
  BandRatioOptions,
  SpectralBandRenderOptions,
  SpectralBandRenderResult,
  SpectralCompositeRenderOptions,
  SpectralDerivedDataset,
  SpectralRangeOptions,
  SpectralChannelSelection,
  SpectralCompositeRenderResult,
} from './spectral.ts'
import {
  bandRatio as ratio,
  integrateSpectralRange as integrate,
  nearestSpectralChannel as nearest,
  renderSpectralBand as renderBand,
  renderSpectralComposite as renderComposite,
} from './spectral.ts'
import type { ScientificVolumeProjectionOptions, ScientificVolumeSliceOptions } from './volume.ts'
import {
  projectScientificVolume as projectVolume,
  sliceScientificVolume as sliceVolume,
} from './volume.ts'

export const measureScientificPlane = (
  dataset: ScientificDataset,
  options: Readonly<ScientificPlaneMeasureOptions>,
): Promise<ScientificPlaneMeasurement> => measurePlane(dataset, options)

export const renderScientificPlane = (
  dataset: ScientificDataset,
  options: Readonly<ScientificPlaneRenderOptions>,
): Promise<ScientificRenderedPlane> => renderPlane(dataset, options)

export const sliceScientificVolume = (
  dataset: ScientificDataset,
  options: Readonly<ScientificVolumeSliceOptions>,
): ScientificDataset => sliceVolume(dataset, options)

export const projectScientificVolume = (
  dataset: ScientificDataset,
  options: Readonly<ScientificVolumeProjectionOptions>,
): ScientificDataset => projectVolume(dataset, options)

export const nearestSpectralChannel = (
  dataset: ScientificDataset,
  requested: number,
  spectralAxis: string,
): SpectralChannelSelection => nearest(dataset, requested, spectralAxis)

export const renderSpectralBand = (
  dataset: ScientificDataset,
  options: Readonly<SpectralBandRenderOptions>,
): Promise<SpectralBandRenderResult> => renderBand(dataset, options)

export const renderSpectralComposite = (
  dataset: ScientificDataset,
  options: Readonly<SpectralCompositeRenderOptions>,
): Promise<SpectralCompositeRenderResult> => renderComposite(dataset, options)

export const integrateSpectralRange = (
  dataset: ScientificDataset,
  options: Readonly<SpectralRangeOptions>,
): SpectralDerivedDataset => integrate(dataset, options)

export const bandRatio = (
  dataset: ScientificDataset,
  options: Readonly<BandRatioOptions>,
): SpectralDerivedDataset => ratio(dataset, options)
