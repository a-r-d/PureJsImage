import sharp from 'sharp'

interface Point {
  readonly x: number
  readonly y: number
}

const isPoint = (value: unknown): value is Point => {
  if (typeof value !== 'object' || value === null) return false
  if (!('x' in value) || !('y' in value)) return false
  return (
    typeof value.x === 'number' &&
    Number.isInteger(value.x) &&
    typeof value.y === 'number' &&
    Number.isInteger(value.y)
  )
}

const parsed: unknown = JSON.parse(process.argv[2] ?? '[]')
if (!Array.isArray(parsed) || !parsed.every(isPoint)) throw new Error('Invalid WebP sample points')

const input = await new Promise<Uint8Array>((resolve, reject) => {
  process.once('message', (message: unknown) => {
    if (message instanceof Uint8Array) resolve(message)
    else reject(new Error('Invalid WebP oracle input'))
  })
})

const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const samples = parsed.map(({ x, y }) => {
  if (x < 0 || y < 0 || x >= decoded.info.width || y >= decoded.info.height) {
    return { x, y }
  }
  const offset = (y * decoded.info.width + x) * 4
  return {
    x,
    y,
    red: decoded.data[offset] ?? -1,
    green: decoded.data[offset + 1] ?? -1,
    blue: decoded.data[offset + 2] ?? -1,
    alpha: decoded.data[offset + 3] ?? -1,
  }
})

process.send?.({ width: decoded.info.width, height: decoded.info.height, samples })
process.disconnect?.()
