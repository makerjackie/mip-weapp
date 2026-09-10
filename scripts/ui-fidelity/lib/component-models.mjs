/**
 * Component view-model loading for the pixel proxy.
 *
 * Components like mip-cooperation-card compute their render `view` in TS (model.ts)
 * via observers; the proxy never runs component JS, so without this the template's
 * {{view.*}} interpolations all read undefined and the card renders empty. Here we
 * strip types with node:module and evaluate the model plus its in-repo TS deps in a
 * dependency-ordered closure — no bundler, no tsx, same trick as mip-icons.mjs.
 */
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'

const RUNTIME_IMPORT_RE = /^import\s+\{([^}]+)\}\s+from\s+'([^']+)'\s*$/gm

function evalTsModule(file, resolver, cache) {
  if (cache.has(file)) {
    return cache.get(file)
  }
  const source = fs.readFileSync(file, 'utf8')
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' })
  const deps = {}
  const code = stripped.replace(RUNTIME_IMPORT_RE, (_, names, spec) => {
    const depFile = resolver(file, spec)
    const depExports = evalTsModule(depFile, resolver, cache)
    const key = `__dep${Object.keys(deps).length}`
    deps[key] = depExports
    return `const {${names}} = ${key}`
  })
  const exportNames = [
    ...stripped.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm,
    ),
  ].map(m => m[1])
  const body = code.replace(/^export\s+/gm, '')
  const dependencyNames = Object.keys(deps)
  const fn = new vm.Script(
    `(function (${dependencyNames.join(', ')}) {\n${body}\nreturn { ${exportNames.join(', ')} }\n})(...__deps)`,
  )
  const exports = fn.runInNewContext({ __deps: Object.values(deps) })
  cache.set(file, exports)
  return exports
}

/** Loads src/components/mip-cooperation-card/model.ts with its catalogs dep resolved on disk. */
export function loadCooperationCardModel(srcDir) {
  const cache = new Map()
  const resolver = (fromFile, spec) => {
    const base = path.resolve(path.dirname(fromFile), spec)
    for (const candidate of [
      `${base}.ts`,
      `${base}.js`,
      path.join(base, 'index.ts'),
    ]) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    throw new Error(
      `component-model: cannot resolve '${spec}' from ${fromFile}`,
    )
  }
  return evalTsModule(
    path.join(srcDir, 'components/mip-cooperation-card/model.ts'),
    resolver,
    cache,
  )
}
