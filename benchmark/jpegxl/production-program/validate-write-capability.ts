import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const record = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value
}

/** Validate current scope separately from the historical milestone measurements. */
export async function validateJpegXlWriteCapability(
  capability: unknown,
  milestoneState: unknown,
): Promise<void> {
  const write = record(capability, 'jpegxl.write')
  const milestones = record(milestoneState, 'programState.milestones')
  if (write.status !== 'limited')
    throw new Error('JPEG XL write capability no longer matches the recorded limited boundary')
  const staticLossy = write.label === 'Stable lossless, static lossy and exact transcode'
  const lossless =
    staticLossy ||
    write.label === 'Stable lossless and exact transcode' ||
    write.label === 'Stable lossless and exact transcode; experimental lossy'
  if (write.label === 'Stable exact transcode' || lossless) {
    if (record(milestones.M1, 'M1').stablePromotionGatePassed !== true)
      throw new Error('Stable exact transcode requires the Milestone 1 promotion gate')
    if (lossless && record(milestones.M2, 'M2').stablePromotionGatePassed !== true)
      throw new Error('Stable lossless encoding requires the Milestone 2 promotion gate')
  } else if (write.label !== 'Experimental') {
    throw new Error('JPEG XL write capability has an unrecognized label')
  }
  const milestone7 = milestones.M7 === undefined ? {} : record(milestones.M7, 'M7')
  if (write.label === 'Stable lossless and exact transcode; experimental lossy') {
    if (
      milestone7.stablePromotionGatePassed === true ||
      milestone7.staticLossyQualification !== undefined
    )
      throw new Error('Experimental lossy label conflicts with the Milestone 7 promotion gate')
  }
  if (!staticLossy) {
    if (milestone7.staticLossyQualification !== undefined)
      throw new Error('Recorded static lossy qualification requires the scoped capability label')
    return
  }
  const qualification = record(milestone7.staticLossyQualification, 'M7 static lossy qualification')
  if (
    qualification.scope !== 'static-integer-gray-rgb-rgba' ||
    qualification.status !== 'Stable' ||
    qualification.lossyAnimation !== 'Experimental' ||
    record(milestones.M8, 'M8').stablePromotionGatePassed === true
  )
    throw new Error('Static lossy qualification must keep lossy animation Experimental')
  const root = 'benchmark/jpegxl/production-program/'
  const indexPath = `${root}visual-contrast-20260929/evidence-index.json`
  const reportPath = `${root}m7-visual-contrast-qualification.md`
  if (qualification.evidenceIndex !== indexPath || qualification.report !== reportPath)
    throw new Error('Static lossy qualification must reference the recorded decision')
  const indexBytes = await readFile(indexPath)
  const reportBytes = await readFile(reportPath)
  const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  if (
    qualification.evidenceIndexSha256 !== hash(indexBytes) ||
    qualification.reportSha256 !== hash(reportBytes)
  )
    throw new Error('Static lossy qualification decision checksum mismatch')
  const index = record(JSON.parse(indexBytes.toString('utf8')), 'static lossy evidence index')
  if (
    typeof qualification.implementationCommit !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(qualification.implementationCommit) ||
    qualification.implementationCommit !== index.implementationCommit ||
    index.capabilityDecision !==
      'Stable documented static integer gray/RGB/RGBA lossy subset. Lossy animation remains Experimental. No release or version change.'
  )
    throw new Error('Static lossy qualification conflicts with the recorded evidence decision')
}
