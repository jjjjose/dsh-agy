import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Host-owned package is unavailable locally; tests exercise the documented
    // registration contract, not an installed Harness runtime.
    alias: { '@deepseek-ai/dsh-tools': fileURLToPath(new URL('./tests/fixtures/dsh-tools.ts', import.meta.url)) },
  },
})
