import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'
import tailwindcss from '@tailwindcss/vite'

// The SST shell — Astro + Vue, parallels the bench's stack.
// Static-builds the kinds gallery + per-kind instance pages at build
// time (reading the packages/ directory); the session view embeds the
// bench via iframe pointing at the runtime's session port.
export default defineConfig({
  integrations: [vue()],
  vite: { plugins: [tailwindcss()] },
})
