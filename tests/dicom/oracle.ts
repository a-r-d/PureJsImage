import { spawnSync } from 'node:child_process'
import { implicitVrLittleEndianUid } from '../../src/scientific/formats/dicom/constants.ts'

export interface DicomOracleElement {
  readonly tag: string
  readonly vr?: string
  readonly value?: string
}

export interface DicomOracleResult {
  readonly available: boolean
  readonly engine?: 'pydicom'
  readonly transferSyntaxUid?: string
  readonly elements?: readonly DicomOracleElement[]
  readonly reason?: string
}

const pydicomScript = `
import json, sys
try:
    import pydicom
    from pydicom.filereader import dcmread
except Exception as error:
    print(json.dumps({"available": False, "reason": str(error)}))
    raise SystemExit(0)
path = sys.argv[1]
dataset = dcmread(path, stop_before_pixels=True, force=False)
elements = []
for element in dataset.iterall():
    tag = f"{int(element.tag):08X}"
    record = {"tag": tag}
    if element.VR:
        record["vr"] = element.VR
    if element.VR in {"UI", "CS", "US", "SS", "SH"} and element.value is not None:
        record["value"] = str(element.value)
    elements.append(record)
print(json.dumps({
    "available": True,
    "engine": "pydicom",
    "transferSyntaxUid": str(dataset.file_meta.TransferSyntaxUID),
    "elements": elements,
}))
`

const runOracle = (command: string, args: readonly string[]): DicomOracleResult | undefined => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0 || result.stdout.trim().length === 0) return undefined
  const parsed: unknown = JSON.parse(result.stdout)
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('available' in parsed) ||
    typeof parsed.available !== 'boolean'
  ) {
    return undefined
  }
  return parsed as DicomOracleResult
}

export const readDicomOracle = (path: string): DicomOracleResult => {
  const direct = runOracle('python3', ['-c', pydicomScript, path])
  if (direct?.available === true) return direct
  const isolated = runOracle('uv', [
    'run',
    '--with',
    'pydicom',
    'python',
    '-c',
    pydicomScript,
    path,
  ])
  if (isolated?.available === true) return isolated
  return {
    available: false,
    reason: direct?.reason ?? isolated?.reason ?? 'pydicom is not available',
  }
}

export const implicitOracleUid = implicitVrLittleEndianUid

const pydicomPixelScript = `
import json, sys
try:
    import pydicom
    from pydicom.filereader import dcmread
except Exception as error:
    print(json.dumps({"available": False, "reason": str(error)}))
    raise SystemExit(0)
path = sys.argv[1]
dataset = dcmread(path, force=False)
pixels = dataset.pixel_array.astype("int64").reshape(-1).tolist()
print(json.dumps({"available": True, "engine": "pydicom", "pixels": pixels}))
`

export interface DicomOraclePixels {
  readonly available: boolean
  readonly engine?: 'pydicom'
  readonly pixels?: readonly number[]
  readonly reason?: string
}

export const readDicomOraclePixels = (path: string): DicomOraclePixels => {
  const parse = (command: string, args: readonly string[]): DicomOraclePixels | undefined => {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    if (result.status !== 0 || result.stdout.trim().length === 0) return undefined
    const parsed: unknown = JSON.parse(result.stdout)
    if (parsed === null || typeof parsed !== 'object' || !('available' in parsed)) return undefined
    return parsed as DicomOraclePixels
  }
  const direct = parse('python3', ['-c', pydicomPixelScript, path])
  if (direct?.available === true) return direct
  const isolated = parse('uv', [
    'run',
    '--with',
    'pydicom',
    'python',
    '-c',
    pydicomPixelScript,
    path,
  ])
  if (isolated?.available === true) return isolated
  return {
    available: false,
    reason: direct?.reason ?? isolated?.reason ?? 'pydicom is not available',
  }
}
