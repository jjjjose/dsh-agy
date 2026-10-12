// Structural smoke test for the built artifacts. Verifies the Harness can load
// the plugin: correct ESM exports, host packages left external, and the client
// wrapped in the `__ModuleLoader__` shape. No runtime import of @deepseek-ai/*.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

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
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')

// Installation metadata must agree with the unchanged Harness module loader.
check('package exports host and client', pkg.exports['.'] === './lib/index.js' && pkg.exports['./client'] === './lib/client.js')
check('package declares web client', pkg.dsh.client.platform === 'web' && Array.isArray(pkg.dsh.client.inject))
check('package declares bundle patch', pkg.dsh.bundle.patch === './cordis.patch.yml')
check('bundle patch inserts this package', /- insert:/.test(patch) && patch.includes(`name: '${pkg.name}'`))
check('publish includes both bundles and patch', ['lib/index.js', 'lib/client.js', 'cordis.patch.yml'].every((file) => pkg.files.includes(file)))

// Host plugin shape
check('index.js exports apply', /export\s*\{[^}]*\bapply\b/.test(index))
check('index.js exports inject', /export\s*\{[^}]*\binject\b/.test(index))
check('index.js exports name', /export\s*\{[^}]*\bname\b/.test(index))
check('index.js exports Config', /export\s*\{[^}]*\bConfig\b/.test(index))
check('index.js exports default plugin for package loading', /\bas default\b/.test(index))

// Host-provided packages stay external (imported, not inlined)
check('index.js keeps @earendil-works/pi-ai external', index.includes('from "@earendil-works/pi-ai"'))
check('index.js keeps @deepseek-ai/dsh-llm-pi-ai external', index.includes('"@deepseek-ai/dsh-llm-pi-ai"'))
check('index.js keeps @deepseek-ai/dsh-credentials external', index.includes('"@deepseek-ai/dsh-credentials"'))
check('index.js keeps native DSH tools external', index.includes('"@deepseek-ai/dsh-tools"'))

// Client wrapper contract
check('client.js wrapped by __ModuleLoader__', client.startsWith('window.__ModuleLoader__.load({ id: "dsh-agy"'))
check('client.js returns module.exports', client.includes('return module.exports;'))
check('client.js requires react at runtime', client.includes('require("react")') || client.includes("require('react')"))

// Execute only the loader contract in a sandbox: no host imports, credentials,
// network, OAuth, or personal Harness configuration are touched.
let loaded
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild() {} },
}
try {
  runInNewContext(client, {
    window: { __ModuleLoader__: { load(descriptor) { loaded = descriptor } } },
    document: documentStub,
  }, { timeout: 1000 })
  const exported = loaded?.factory((id) => {
    if (id !== 'react') throw new Error(`Unexpected client dependency: ${id}`)
    return {}
  })
  check('loader id matches package', loaded?.id === pkg.name)
  check('client exports apply and slots injection', typeof exported?.apply === 'function' && exported?.inject?.includes('slots'))
  let descriptor
  let cleanup
  let disposed = false
  await exported.apply({
    slots: {
      inject(_name, factory) { factory(); return () => { disposed = true } },
      register(value, component) { descriptor = value; check('settings page component is callable', typeof component === 'function'); return () => {} },
    },
    effect(factory) { cleanup = factory() },
  })
  check('settings page registered under package key', descriptor?.name === 'plugins.bundle.config' && descriptor?.key === pkg.name)
  cleanup?.()
  check('settings page registration has lifecycle cleanup', disposed)
} catch (error) {
  check('client loader executes', false, error.message)
}

if (failures.length > 0) {
  console.error(`\nsmoke FAILED (${failures.length} checks)`)
  process.exit(1)
}
console.log('\nsmoke OK — artifacts are loadable by the Harness')
