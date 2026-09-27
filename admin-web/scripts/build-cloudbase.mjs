import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { mkdir, writeFile, cp, access, rm } from 'node:fs/promises'

const adminRoot = fileURLToPath(new URL('../', import.meta.url))
const repository = resolve(adminRoot, '..')
// Vite declares esbuild as its build dependency; use that installed version.
const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vite/package.json'))
const { build } = viteRequire('esbuild')
const output = resolve(repository, '.tmp/admin-cloudbase-function')
await access(resolve(adminRoot, 'dist/index.html'))
await mkdir(output, { recursive: true })
await build({
  entryPoints: [resolve(adminRoot, 'cloudbase/index.ts')], outfile: resolve(output, 'index.js'),
  bundle: true, platform: 'node', target: 'node20', format: 'cjs', sourcemap: false,
  packages: 'bundle', logLevel: 'warning',
})
await writeFile(resolve(output, 'package.json'), JSON.stringify({ name: 'mip-admin-web-api', private: true, version: '1.0.0', main: 'index.js', engines: { node: '>=20' } }, null, 2) + '\n')
// Static files are an optional temporary gateway fallback. Production can route
// the same dist to CloudBase static hosting, keeping /api/* on this function.
await rm(resolve(output, 'public'), { recursive: true, force: true })
await cp(resolve(adminRoot, 'dist'), resolve(output, 'public'), { recursive: true, filter: source => !source.endsWith('.map') && !source.endsWith('/_headers') && !source.endsWith('/_redirects') })
console.log(JSON.stringify({ output, runtime: 'Nodejs20.19', handler: 'index.main', functionName: 'mip-admin-web-api', dependenciesBundled: true }))
