import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'
import tailwindcss from '@tailwindcss/vite'

// The bench SPA. Static output (the sim serves the built dist/); Vue
// islands for the interactive pieces; Tailwind 4 via its Vite plugin.
export default defineConfig({
  integrations: [vue({ appEntrypoint: undefined })],
  vite: {
    plugins: [tailwindcss()],
    server: { host: true },
  },
  build: { format: 'directory' },
})
