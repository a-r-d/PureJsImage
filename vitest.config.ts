import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Keep saved experiment sources out of repository test discovery.
    exclude: [...configDefaults.exclude, '.tmp/**', 'benchmark/.tmp/**'],
  },
})
