// Structural smoke test for the built artifacts. Verifies the Harness can load
// the plugin: correct ESM exports, host packages left external, and the client
// wrapped in the `__ModuleLoader__` shape. No runtime import of @deepseek-ai/*.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const failures = []

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok  ${label}`)
  } else {
    failures.push(label)
    console.error(` FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const index = await readFile(join(root, 'lib', 'index.js'), 'utf8')
const client = await readFile(join(root, 'lib', 'client.js'), 'utf8')

// Host plugin shape
check('index.js exports apply', /export\s*\{[^}]*\bapply\b/.test(index))
check('index.js exports inject', /export\s*\{[^}]*\binject\b/.test(index))
check('index.js exports name', /export\s*\{[^}]*\bname\b/.test(index))
check('index.js exports Config', /export\s*\{[^}]*\bConfig\b/.test(index))

// Host-provided packages stay external (imported, not inlined)
check('index.js keeps @earendil-works/pi-ai external', index.includes('from "@earendil-works/pi-ai"'))
check('index.js keeps @deepseek-ai/dsh-llm-pi-ai external', index.includes('"@deepseek-ai/dsh-llm-pi-ai"'))
check('index.js keeps @deepseek-ai/dsh-credentials external', index.includes('"@deepseek-ai/dsh-credentials"'))

// Client wrapper contract
check('client.js wrapped by __ModuleLoader__', client.startsWith('window.__ModuleLoader__.load({ id: "dsh-agy"'))
check('client.js returns module.exports', client.includes('return module.exports;'))
check('client.js requires react at runtime', client.includes('require("react")') || client.includes("require('react')"))

if (failures.length > 0) {
  console.error(`\nsmoke FAILED (${failures.length} checks)`)
  process.exit(1)
}
console.log('\nsmoke OK — artifacts are loadable by the Harness')
