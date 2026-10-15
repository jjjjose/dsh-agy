/** Exercise the actual host sources without the development-only DSH shims. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const host = process.env.DSH_SOURCE
if (!host) throw new Error('Set DSH_SOURCE to a DeepSeek Harness source checkout with its dependencies installed')
const filename = resolve(host, 'tsconfig.base.json')
const parsed = ts.parseConfigFileTextToJson(filename, readFileSync(filename, 'utf8'))
if (parsed.error) throw new Error('Cannot parse host tsconfig.base.json')
const paths = parsed.config.compilerOptions.paths as Record<string, string[]>
export default defineConfig({
  resolve: {
    alias: [
      ...Object.entries(paths).filter(([name]) => !name.includes('*')).map(([name, targets]) => ({ find: name, replacement: resolve(host, targets[0]!) })),
      { find: /^@earendil-works\/pi-ai$/, replacement: fileURLToPath(import.meta.resolve('@earendil-works/pi-ai')) },
      { find: '@earendil-works/pi-ai/api/google-shared', replacement: fileURLToPath(import.meta.resolve('@earendil-works/pi-ai/api/google-shared')) },
    ],
  },
  test: { include: ['host-tests/**/*.test.ts'] },
})
