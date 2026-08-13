import type { ScientificDataset } from './dataset-v2.ts'
import type {
  LabeledScientificPlaneMeasurement,
  LabeledScientificPlaneMeasureOptions,
  LabeledScientificPlaneRenderOptions,
  LabeledScientificRenderedPlane,
} from './render.ts'
import {
  measureScientificPlane as measurePlane,
  renderScientificPlane as renderPlane,
} from './render.ts'
import type {
  LabeledBandRatioOptions,
  LabeledSpectralBandRenderOptions,
  LabeledSpectralBandRenderResult,
  LabeledSpectralCompositeRenderOptions,
  LabeledSpectralDerivedDataset,
  LabeledSpectralRangeOptions,
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
import type {
  LabeledScientificVolumeProjectionOptions,
  LabeledScientificVolumeSliceOptions,
} from './volume.ts'
import {
  projectScientificVolume as projectVolume,
  sliceScientificVolume as sliceVolume,
} from './volume.ts'

export const measureScientificPlane = (
  dataset: ScientificDataset,
  options: Readonly<LabeledScientificPlaneMeasureOptions>,
): Promise<LabeledScientificPlaneMeasurement> => measurePlane(dataset, options)

export const renderScientificPlane = (
  dataset: ScientificDataset,
  options: Readonly<LabeledScientificPlaneRenderOptions>,
): Promise<LabeledScientificRenderedPlane> => renderPlane(dataset, options)

export const sliceScientificVolume = (
  dataset: ScientificDataset,
  options: Readonly<LabeledScientificVolumeSliceOptions>,
): ScientificDataset => sliceVolume(dataset, options)

export const projectScientificVolume = (
  dataset: ScientificDataset,
  options: Readonly<LabeledScientificVolumeProjectionOptions>,
): ScientificDataset => projectVolume(dataset, options)

export const nearestSpectralChannel = (
  dataset: ScientificDataset,
  requested: number,
  spectralAxis: string,
): SpectralChannelSelection => nearest(dataset, requested, spectralAxis)

export const renderSpectralBand = (
  dataset: ScientificDataset,
  options: Readonly<LabeledSpectralBandRenderOptions>,
): Promise<LabeledSpectralBandRenderResult> => renderBand(dataset, options)

export const renderSpectralComposite = (
  dataset: ScientificDataset,
  options: Readonly<LabeledSpectralCompositeRenderOptions>,
): Promise<SpectralCompositeRenderResult> => renderComposite(dataset, options)

export const integrateSpectralRange = (
  dataset: ScientificDataset,
  options: Readonly<LabeledSpectralRangeOptions>,
): LabeledSpectralDerivedDataset => integrate(dataset, options)

export const bandRatio = (
  dataset: ScientificDataset,
  options: Readonly<LabeledBandRatioOptions>,
): LabeledSpectralDerivedDataset => ratio(dataset, options)
