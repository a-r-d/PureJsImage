import { tiaEmiSignature } from '../../src/scientific/formats/tia-emi.ts'

export interface GeneratedTiaEmiObjectOptions {
  readonly uuid: string
  readonly mode?: string
  readonly microscope?: string
  readonly user?: string
  readonly acceleratingVoltageVolts?: number
  readonly acquireDate?: string
  readonly detectorName?: string
  readonly calibrationValue?: number
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const descriptionField = (label: string, value: string, unit = ''): string =>
  `<Data><Label>${escapeXml(label)}</Label><Value>${escapeXml(value)}</Value><Unit>${escapeXml(unit)}</Unit></Data>`

export const generatedTiaEmiObject = (options: Readonly<GeneratedTiaEmiObjectOptions>): string => {
  const descriptions = [
    ...(options.microscope === undefined
      ? []
      : [descriptionField('Microscope', options.microscope)]),
    ...(options.user === undefined ? [] : [descriptionField('User', options.user)]),
    ...(options.mode === undefined ? [] : [descriptionField('Mode', options.mode)]),
  ].join('')
  const trueImageHeader =
    options.calibrationValue === undefined
      ? ''
      : `<TrueImageHeaderInfo>${escapeXml(
          `<Root><Data><Index>45</Index><Value>${options.calibrationValue}</Value></Data></Root>`,
        )}</TrueImageHeaderInfo>`
  return `<ObjectInfo><Uuid>${escapeXml(options.uuid)}</Uuid>${
    options.acquireDate === undefined
      ? ''
      : `<AcquireDate>${escapeXml(options.acquireDate)}</AcquireDate>`
  }<ExperimentalConditions><MicroscopeConditions>${
    options.acceleratingVoltageVolts === undefined
      ? ''
      : `<AcceleratingVoltage>${options.acceleratingVoltageVolts}</AcceleratingVoltage>`
  }<Tilt1>0.1</Tilt1><Tilt2>-0.2</Tilt2></MicroscopeConditions></ExperimentalConditions><ExperimentalDescription><Root>${descriptions}</Root></ExperimentalDescription>${trueImageHeader}<AcquireInfo>${
    options.detectorName === undefined
      ? ''
      : `<CameraNamePath>${escapeXml(options.detectorName)}</CameraNamePath>`
  }</AcquireInfo></ObjectInfo>`
}

export const generateTiaEmiFixture = (objects: readonly string[]): Uint8Array => {
  const encoder = new TextEncoder()
  const prefix = new Uint8Array(tiaEmiSignature.byteLength + 23)
  prefix.set(tiaEmiSignature)
  prefix.fill(0xa5, tiaEmiSignature.byteLength)
  const encoded = objects.map((object) => encoder.encode(object))
  const length = encoded.reduce((total, object) => total + object.byteLength + 7, prefix.byteLength)
  const output = new Uint8Array(length)
  output.set(prefix)
  let offset = prefix.byteLength
  for (const object of encoded) {
    output.set(object, offset)
    offset += object.byteLength
    output.fill(0x5a, offset, offset + 7)
    offset += 7
  }
  return output
}
