import { allocateJpegXlArray, type JpegXlEncoderMemory } from './jpegxl-encoder-memory.ts'

export interface JpegXlFlatPatch {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface JpegXlFlatPatchGroup {
  readonly source: JpegXlFlatPatch
  readonly placements: readonly JpegXlFlatPatch[]
  atlasX: number
  atlasY: number
}

const sameColor = (
  pixels: Uint8Array,
  first: number,
  second: number,
  tolerance: number,
): boolean => {
  const a = first * 3,
    b = second * 3
  return (
    Math.abs((pixels[a] ?? 0) - (pixels[b] ?? 0)) <= tolerance &&
    Math.abs((pixels[a + 1] ?? 0) - (pixels[b + 1] ?? 0)) <= tolerance &&
    Math.abs((pixels[a + 2] ?? 0) - (pixels[b + 2] ?? 0)) <= tolerance
  )
}

/** Avoid a full background search on photographs and smooth gradients. */
export const hasFlatScreenshotBackground = (
  pixels: Uint8Array,
  width: number,
  height: number,
): boolean => {
  let sampled = 0,
    flat = 0
  for (let y = 0; y + 4 <= height; y += 17) {
    for (let x = 0; x + 4 <= width; x += 17) {
      sampled++
      const base = y * width + x
      let matches = true
      for (let dy = 0; dy < 4 && matches; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          if (sameColor(pixels, base, base + dy * width + dx, 1)) continue
          matches = false
          break
        }
      }
      if (matches) flat++
    }
  }
  return sampled > 0 && flat * 20 >= sampled * 7
}

/** Search locally flat backgrounds, then group byte-identical small foreground rectangles. */
export const findFlatScreenshotPatches = (
  pixels: Uint8Array,
  width: number,
  height: number,
  memory: JpegXlEncoderMemory,
): JpegXlFlatPatchGroup[] => {
  const count = width * height
  const background = allocateJpegXlArray(memory, Uint8Array, count)
  const root = allocateJpegXlArray(memory, Int32Array, count)
  const queue = allocateJpegXlArray(memory, Int32Array, count)
  const visited = allocateJpegXlArray(memory, Uint8Array, count)
  const stack = allocateJpegXlArray(memory, Int32Array, count)
  try {
    let tail = 0
    for (let y = 4; y + 8 < height; y += 4) {
      for (let x = 4; x + 8 < width; x += 4) {
        const base = y * width + x
        let flat = true
        for (let dy = 0; dy < 4 && flat; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            if (sameColor(pixels, base, base + dy * width + dx, 1)) continue
            flat = false
            break
          }
        }
        if (!flat) continue
        let neighbors = 0
        for (let dy = -4; dy <= 4; dy += 4) {
          for (let dx = -4; dx <= 4; dx += 4) {
            if (sameColor(pixels, base, base + dy * width + dx, 2)) neighbors++
          }
        }
        if (neighbors < 8) continue
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            const at = base + dy * width + dx
            if (background[at]) continue
            background[at] = 1
            root[at] = base
            queue[tail++] = at
          }
        }
      }
    }
    let head = 0
    while (head < tail) {
      const at = queue[head++] ?? 0,
        origin = root[at] ?? 0,
        x = at % width,
        y = (at / width) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx,
            ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const next = ny * width + nx
          if (background[next]) continue
          if (Math.abs(nx - (origin % width)) + Math.abs(ny - ((origin / width) | 0)) > 50) continue
          if (!sameColor(pixels, at, next, 2) || !sameColor(pixels, origin, next, 5)) continue
          background[next] = 1
          root[next] = origin
          queue[tail++] = next
        }
      }
    }
    const byShape = new Map<string, JpegXlFlatPatch[]>()
    let components = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const start = y * width + x
        if (background[start] || visited[start]) continue
        if (++components > 20_000) return []
        visited[start] = 1
        stack[0] = start
        let size = 1,
          componentPixels = 0,
          minX = x,
          maxX = x,
          minY = y,
          maxY = y
        while (size > 0) {
          const at = stack[--size] ?? 0,
            px = at % width,
            py = (at / width) | 0
          componentPixels++
          if (px < minX) minX = px
          if (px > maxX) maxX = px
          if (py < minY) minY = py
          if (py > maxY) maxY = py
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = px + dx,
                ny = py + dy
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
              const next = ny * width + nx
              if (background[next] || visited[next]) continue
              visited[next] = 1
              stack[size++] = next
            }
          }
        }
        const patchWidth = maxX - minX + 1,
          patchHeight = maxY - minY + 1
        if (
          patchWidth > 64 ||
          patchHeight > 64 ||
          patchWidth * patchHeight < 8 ||
          componentPixels < 2
        )
          continue
        const key = `${patchWidth}:${patchHeight}`
        const patches = byShape.get(key) ?? []
        patches.push({ x: minX, y: minY, width: patchWidth, height: patchHeight })
        byShape.set(key, patches)
      }
    }
    const same = (a: JpegXlFlatPatch, b: JpegXlFlatPatch): boolean => {
      for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) {
          const first = ((a.y + y) * width + a.x + x) * 3,
            second = ((b.y + y) * width + b.x + x) * 3
          if (
            pixels[first] !== pixels[second] ||
            pixels[first + 1] !== pixels[second + 1] ||
            pixels[first + 2] !== pixels[second + 2]
          )
            return false
        }
      }
      return true
    }
    const groups: JpegXlFlatPatchGroup[] = []
    for (const patches of byShape.values()) {
      const byHash = new Map<number, JpegXlFlatPatch[]>()
      for (const patch of patches) {
        let hash = 2_166_136_261
        for (let y = 0; y < patch.height; y++) {
          for (let x = 0; x < patch.width; x++) {
            const offset = ((patch.y + y) * width + patch.x + x) * 3
            hash = Math.imul(hash ^ (pixels[offset] ?? 0), 16_777_619)
            hash = Math.imul(hash ^ (pixels[offset + 1] ?? 0), 16_777_619)
            hash = Math.imul(hash ^ (pixels[offset + 2] ?? 0), 16_777_619)
          }
        }
        const bucket = byHash.get(hash) ?? []
        bucket.push(patch)
        byHash.set(hash, bucket)
      }
      for (const bucket of byHash.values()) {
        while (bucket.length > 1) {
          const first = bucket.pop()
          if (!first) break
          const placements: JpegXlFlatPatch[] = [first]
          for (let index = bucket.length - 1; index >= 0; index--) {
            const other = bucket[index]
            if (!other || !same(first, other)) continue
            placements.push(other)
            bucket.splice(index, 1)
          }
          if (placements.length >= 2)
            groups.push({ source: first, placements, atlasX: 0, atlasY: 0 })
        }
      }
    }
    return groups
  } finally {
    memory.release(stack)
    memory.release(visited)
    memory.release(queue)
    memory.release(root)
    memory.release(background)
  }
}
