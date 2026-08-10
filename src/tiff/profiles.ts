import { invalidInput } from '../errors.ts'
import type { TiffDocument } from './types.ts'

export interface TiffProfileContext {
  readonly document: TiffDocument
}

export interface TiffProfile<T = unknown> {
  readonly id: string
  readonly priority?: number
  detect(context: Readonly<TiffProfileContext>): boolean | Promise<boolean>
  open(context: Readonly<TiffProfileContext>): T | Promise<T>
}

export interface TiffProfileMatch {
  readonly id: string
  readonly priority: number
  readonly profile: TiffProfile
}

export interface TiffProfileDetectionFailure {
  readonly id: string
  readonly error: unknown
}

export interface TiffProfileDetectionReport {
  readonly matches: readonly TiffProfileMatch[]
  readonly failures: readonly TiffProfileDetectionFailure[]
}

export interface TiffProfileOpenResult {
  readonly profileId: string
  readonly value: unknown
  readonly detectionFailures: readonly TiffProfileDetectionFailure[]
}

const checkedProfile = (profile: TiffProfile): TiffProfile => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.id)) {
    throw invalidInput(`TIFF profile id ${profile.id || '<empty>'} is invalid`)
  }
  const priority = profile.priority ?? 0
  if (!Number.isSafeInteger(priority)) {
    throw invalidInput(`TIFF profile ${profile.id} priority must be a safe integer`)
  }
  return profile
}

export class TiffProfileRegistry {
  readonly profiles: readonly TiffProfile[]
  readonly #profilesById: ReadonlyMap<string, TiffProfile>

  constructor(profiles: readonly TiffProfile[] = []) {
    const profilesById = new Map<string, TiffProfile>()
    for (const candidate of profiles) {
      const profile = checkedProfile(candidate)
      if (profilesById.has(profile.id)) {
        throw invalidInput(`TIFF profile ${profile.id} is registered more than once`)
      }
      profilesById.set(profile.id, profile)
    }
    this.profiles = Object.freeze([...profilesById.values()])
    this.#profilesById = profilesById
  }

  with(profile: TiffProfile): TiffProfileRegistry {
    return new TiffProfileRegistry([...this.profiles, profile])
  }

  async detect(document: TiffDocument): Promise<TiffProfileDetectionReport> {
    const context = Object.freeze({ document })
    const matches: TiffProfileMatch[] = []
    const failures: TiffProfileDetectionFailure[] = []
    for (const profile of this.profiles) {
      try {
        if (await profile.detect(context)) {
          matches.push(Object.freeze({ id: profile.id, priority: profile.priority ?? 0, profile }))
        }
      } catch (error: unknown) {
        failures.push(Object.freeze({ id: profile.id, error }))
      }
    }
    matches.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    return Object.freeze({ matches: Object.freeze(matches), failures: Object.freeze(failures) })
  }

  async open(
    document: TiffDocument,
    profileId?: string,
  ): Promise<TiffProfileOpenResult | undefined> {
    const context = Object.freeze({ document })
    if (profileId !== undefined) {
      const profile = this.#profilesById.get(profileId)
      if (!profile) throw invalidInput(`TIFF profile ${profileId} is not registered`)
      return Object.freeze({
        profileId,
        value: await profile.open(context),
        detectionFailures: Object.freeze([]),
      })
    }
    const report = await this.detect(document)
    const selected = report.matches[0]
    if (!selected) return undefined
    const conflicting = report.matches.filter((match) => match.priority === selected.priority)
    if (conflicting.length > 1) {
      throw invalidInput(
        `TIFF profile detection is ambiguous at priority ${selected.priority}: ${conflicting
          .map((match) => match.id)
          .join(', ')}`,
      )
    }
    return Object.freeze({
      profileId: selected.id,
      value: await selected.profile.open(context),
      detectionFailures: report.failures,
    })
  }
}

export const createTiffProfileRegistry = (
  profiles: readonly TiffProfile[] = [],
): TiffProfileRegistry => new TiffProfileRegistry(profiles)
