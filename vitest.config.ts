import { configDefaults, defineConfig } from 'vitest/config'

// Keep saved experiment sources and agent worktrees out of repository test discovery.
const exclude = [...configDefaults.exclude, '.tmp/**', 'benchmark/.tmp/**', '.claude/**']

/**
 * Exhaustive JPEG XL encoder searches that take a minute or more each. `npm test` and
 * `npm run check` leave them out; `npm run test:slow`, `npm run check:full` and CI run them.
 * Measured on 22 November 2026, they took 55 of the suite's 76 summed minutes.
 */
const slowTests = [
  'tests/jpegxl-artwork.test.ts',
  'tests/jpegxl-cone-selection.test.ts',
  'tests/jpegxl-dc-model.test.ts',
  'tests/jpegxl-document-patches.test.ts',
  'tests/jpegxl-encoder-memory.test.ts',
  'tests/jpegxl-grouped-search.test.ts',
  'tests/jpegxl-learned-lossless.test.ts',
  'tests/jpegxl-luma-contexts-async.test.ts',
  'tests/jpegxl-luma-contexts.test.ts',
  'tests/jpegxl-m7-lossless.test.ts',
  'tests/jpegxl-m7-vardct-encode.test.ts',
  'tests/jpegxl-opaque-color-tools.test.ts',
]

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'fast', exclude: [...exclude, ...slowTests] } },
      { test: { name: 'slow', include: slowTests, exclude } },
    ],
  },
})
