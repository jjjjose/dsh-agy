// dsh-agy build: compiles the TypeScript host to an ESM bundle and the client
// settings page to a classic-script CJS bundle wrapped in the Harness
// `window.__ModuleLoader__.load` shape. Host packages provided by the Harness
// runtime (@deepseek-ai/*, pi-ai) and react stay external; zod is bundled.
import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const libDir = join(root, 'lib')

const HOST_EXTERNAL = [
  '@deepseek-ai/*',
  '@earendil-works/pi-ai*',
  'react',
]

await rm(libDir, { recursive: true, force: true })
await mkdir(libDir, { recursive: true })

// 1) Host: ESM, Node target, Harness packages external.
await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(libDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: HOST_EXTERNAL,
  sourcemap: false,
  logLevel: 'info',
})

// 2) Client: CJS (classic JSX, only require('react')), wrapped for the loader.
const clientResult = await build({
  entryPoints: [join(root, 'src', 'client', 'index.tsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['react'],
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  logLevel: 'silent',
})
const clientCode = clientResult.outputFiles[0].text

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const wrapped = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  clientCode,
  'return module.exports;',
  '} });',
  '',
].join('\n')
await writeFile(join(libDir, 'client.js'), wrapped)

console.log('build OK -> lib/index.js, lib/client.js')
