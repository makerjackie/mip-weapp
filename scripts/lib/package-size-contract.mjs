import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

const MIB = 1024 * 1024
const RUNTIME_EXTENSIONS = ['.js', '.json', '.wxml', '.wxss', '.wxs']

export const PACKAGE_SIZE_BUDGETS = Object.freeze({
  mainNonNpmBytes: 1.5 * MIB,
  mainWithReachableNpmBytes: Math.floor(1.9 * MIB),
  dependencyAwarePackageBytes: Math.floor(1.9 * MIB),
  subPackageBytes: Math.floor(1.8 * MIB),
  independentBytes: Math.floor(1.8 * MIB),
  totalNonNpmBytes: 10 * MIB,
})

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function normalize(filePath) {
  return filePath.replaceAll(path.sep, '/').replace(/^\.\//, '')
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) {
    return []
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath]
  })
}

function packageDefinitions(appJson) {
  const entries = Array.isArray(appJson.subPackages)
    ? appJson.subPackages
    : (Array.isArray(appJson.subpackages) ? appJson.subpackages : [])
  const seen = new Set()
  return entries.map((entry) => {
    const root = normalize(String(entry?.root || '')).replace(/^\/+|\/+$/g, '')
    assert(root, 'Every compiled subpackage must declare a non-empty root')
    assert(!seen.has(root), `Duplicate compiled subpackage root: ${root}`)
    seen.add(root)
    return { root, independent: entry?.independent === true }
  }).sort((left, right) => right.root.length - left.root.length)
}

function classifyFile(relativePath, subPackages) {
  return subPackages.find(item => relativePath === item.root || relativePath.startsWith(`${item.root}/`))?.root ?? '__main__'
}

export function collectCompiledPackageFiles(distRoot, appJson) {
  const subPackages = packageDefinitions(appJson)
  const result = new Map([
    ['__main__', new Map()],
    ...subPackages.map(item => [item.root, new Map()]),
  ])

  for (const absolutePath of walkFiles(distRoot)) {
    const relativePath = normalize(path.relative(distRoot, absolutePath))
    const packageId = classifyFile(relativePath, subPackages)
    result.get(packageId).set(relativePath, fs.statSync(absolutePath).size)
  }

  return { packages: result, subPackages }
}

function analyzedPackageFiles(report) {
  assert(Array.isArray(report?.packages), 'Analyze report does not contain packages[]')
  const result = new Map()
  for (const item of report.packages) {
    assert(typeof item?.id === 'string' && item.id, 'Analyze package id is missing')
    assert(!result.has(item.id), `Duplicate analyze package: ${item.id}`)
    const files = new Map()
    for (const file of item.files || []) {
      const filePath = normalize(String(file?.file || ''))
      assert(filePath, `Analyze package ${item.id} contains a file without a path`)
      assert(Number.isFinite(file?.size) && file.size >= 0, `Analyze file has an invalid size: ${filePath}`)
      assert(!files.has(filePath), `Analyze package ${item.id} contains a duplicate file: ${filePath}`)
      files.set(filePath, file.size)
    }
    result.set(item.id, files)
  }
  return result
}

function withoutNpmFiles(files) {
  return new Map([...files].filter(([file]) => !file.includes('/miniprogram_npm/') && !file.startsWith('miniprogram_npm/')))
}

function canonicalAnalyzerFiles(distRoot, packageId, files, subPackages) {
  const item = subPackages.find(entry => entry.root === packageId)
  if (!item || item.independent) {
    return files
  }

  const result = new Map(files)
  for (const [relativePath] of files) {
    if (!relativePath.endsWith('.json')) {
      continue
    }
    const absolutePath = path.join(distRoot, relativePath)
    const json = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
    const components = json.usingComponents
    if (!components || typeof components !== 'object') {
      continue
    }

    let changed = false
    for (const [name, reference] of Object.entries(components)) {
      if (typeof reference !== 'string' || !reference.startsWith('/miniprogram_npm/')) {
        continue
      }
      const target = path.join(distRoot, reference.slice(1))
      components[name] = normalize(path.relative(path.dirname(absolutePath), target))
      changed = true
    }
    if (changed) {
      result.set(relativePath, Buffer.byteLength(`${JSON.stringify(json, null, 2)}\n`))
    }
  }
  return result
}

function sumSizes(files) {
  return [...files.values()].reduce((total, size) => total + size, 0)
}

function assertFileMapsEqual(packageId, actual, analyzed) {
  const missing = [...actual].filter(([file, size]) => analyzed.get(file) !== size)
  const unexpected = [...analyzed].filter(([file, size]) => actual.get(file) !== size)
  assert(
    missing.length === 0 && unexpected.length === 0,
    `Analyze/dist mismatch for ${packageId}: missing or changed [${missing.map(([file]) => file).join(', ')}], unexpected or changed [${unexpected.map(([file]) => file).join(', ')}]`,
  )
}

function resolveReferenceCandidates(distRoot, currentFile, reference) {
  if (!reference || /^(?:plugin|wxfile|https?):\/\//.test(reference)) {
    return []
  }

  let basePath
  if (reference.startsWith('/')) {
    basePath = path.join(distRoot, reference.slice(1))
  }
  else if (reference.startsWith('.')) {
    basePath = path.resolve(path.dirname(currentFile), reference)
  }
  else {
    basePath = path.join(distRoot, 'miniprogram_npm', reference)
  }

  const extension = path.extname(basePath)
  return extension
    ? [basePath]
    : [
        basePath,
        ...RUNTIME_EXTENSIONS.map(item => `${basePath}${item}`),
        ...RUNTIME_EXTENSIONS.map(item => path.join(basePath, `index${item}`)),
      ]
}

function extractReferences(filePath) {
  const extension = path.extname(filePath)
  const source = fs.readFileSync(filePath, 'utf8')
  if (extension === '.json') {
    const json = JSON.parse(source)
    return Object.values(json.usingComponents || {}).map(reference => ({ reference: String(reference), component: true }))
  }
  if (extension === '.js' || extension === '.wxs') {
    return [...source.matchAll(/\brequire(?:\.async)?\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map(match => ({ reference: match[1], component: false }))
  }
  if (extension === '.wxss') {
    return [
      ...[...source.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(match => match[1]),
      ...[...source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)].map(match => match[1]),
    ].map(reference => ({ reference, component: false }))
  }
  if (extension === '.wxml') {
    return [
      ...[...source.matchAll(/<(?:import|include|wxs)(?=\s|>)[^>]*>/g)].flatMap((tag) => {
        const sourceAttribute = /\ssrc=['"]([^'"]+)['"]/.exec(tag[0])
        return sourceAttribute ? [sourceAttribute[1]] : []
      }),
      ...[...source.matchAll(/<(?:image|cover-image|video|audio)(?=\s|>)[^>]*>/g)].flatMap((tag) => {
        const sourceAttribute = /\ssrc=['"]([^'"{]+)['"]/.exec(tag[0])
        return sourceAttribute ? [sourceAttribute[1]] : []
      }),
    ].map(reference => ({ reference, component: false }))
  }
  return []
}

export function collectReachableNpmFiles(distRoot) {
  const npmRoot = path.join(distRoot, 'miniprogram_npm')
  const reachable = new Map()
  const queue = []

  function enqueue(currentFile, reference, component = false) {
    const candidates = resolveReferenceCandidates(distRoot, currentFile, reference)
    const existing = candidates.filter(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (component) {
      assert(existing.length > 0, `Compiled npm component target is missing: ${reference} from ${normalize(path.relative(distRoot, currentFile))}`)
    }
    for (const absolutePath of existing) {
      const relativePath = normalize(path.relative(distRoot, absolutePath))
      if (!absolutePath.startsWith(`${npmRoot}${path.sep}`) || reachable.has(relativePath)) {
        continue
      }
      reachable.set(relativePath, fs.statSync(absolutePath).size)
      queue.push(absolutePath)
    }
  }

  for (const jsonPath of walkFiles(distRoot).filter(file => file.endsWith('.json') && !file.startsWith(`${npmRoot}${path.sep}`))) {
    for (const item of extractReferences(jsonPath)) {
      enqueue(jsonPath, item.reference, item.component)
    }
  }

  while (queue.length) {
    const filePath = queue.shift()
    for (const item of extractReferences(filePath)) {
      enqueue(filePath, item.reference, item.component)
    }
  }

  return reachable
}

export function collectPackageRuntimeClosure(distRoot, appJson, packageId) {
  const compiled = collectCompiledPackageFiles(distRoot, appJson)
  assert(compiled.packages.has(packageId), `Unknown compiled package: ${packageId}`)
  const reachable = new Map()
  const queue = []

  function enqueueFile(absolutePath) {
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return
    }
    const relativePath = normalize(path.relative(distRoot, absolutePath))
    if (relativePath.startsWith('../') || path.isAbsolute(relativePath) || reachable.has(relativePath)) {
      return
    }
    reachable.set(relativePath, fs.statSync(absolutePath).size)
    queue.push(absolutePath)
  }

  function enqueueReference(currentFile, reference, component = false) {
    const candidates = resolveReferenceCandidates(distRoot, currentFile, reference)
    const existing = candidates.filter(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (component) {
      assert(existing.length > 0, `Compiled component target is missing: ${reference} from ${normalize(path.relative(distRoot, currentFile))}`)
    }
    for (const absolutePath of existing) {
      enqueueFile(absolutePath)
    }
  }

  const seedFiles = packageId === '__main__'
    ? withoutNpmFiles(compiled.packages.get(packageId))
    : compiled.packages.get(packageId)
  for (const [relativePath] of seedFiles) {
    enqueueFile(path.join(distRoot, relativePath))
  }

  while (queue.length) {
    const filePath = queue.shift()
    if (!RUNTIME_EXTENSIONS.includes(path.extname(filePath))) {
      continue
    }
    for (const item of extractReferences(filePath)) {
      enqueueReference(filePath, item.reference, item.component)
    }
  }

  return reachable
}

function assertNpmLayout(distRoot, subPackages) {
  for (const item of subPackages.filter(item => !item.independent)) {
    assert(
      !fs.existsSync(path.join(distRoot, item.root, 'miniprogram_npm')),
      `Subpackage ${item.root} must reuse main-package npm dependencies`,
    )
  }

  const npmRoot = path.join(distRoot, 'miniprogram_npm')
  assert(fs.existsSync(npmRoot), 'Compiled main-package miniprogram_npm is missing')
  const topLevelPackages = fs.readdirSync(npmRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  assert(
    topLevelPackages.length === 1 && topLevelPackages[0] === 'tdesign-miniprogram',
    `Unexpected main-package npm dependencies: ${topLevelPackages.join(', ') || '(none)'}`,
  )
}

export function assertPackageSizeContract(root, report, budgets = PACKAGE_SIZE_BUDGETS) {
  const distRoot = path.join(root, 'dist')
  const appJson = JSON.parse(fs.readFileSync(path.join(distRoot, 'app.json'), 'utf8'))
  const compiled = collectCompiledPackageFiles(distRoot, appJson)
  const analyzed = analyzedPackageFiles(report)
  const expectedIds = new Set(compiled.packages.keys())

  assert([...expectedIds].every(id => analyzed.has(id)), 'Analyze report omitted one or more compiled packages')
  assert([...analyzed.keys()].every(id => expectedIds.has(id)), 'Analyze report contains an undeclared package')
  assertNpmLayout(distRoot, compiled.subPackages)

  const sizes = {}
  for (const [packageId, physicalFiles] of compiled.packages) {
    const analyzedFiles = analyzed.get(packageId)
    const comparableFiles = withoutNpmFiles(physicalFiles)
    const canonicalFiles = canonicalAnalyzerFiles(distRoot, packageId, comparableFiles, compiled.subPackages)
    assertFileMapsEqual(packageId, canonicalFiles, analyzedFiles)
    sizes[packageId] = sumSizes(comparableFiles)
  }

  assert(sizes.__main__ <= budgets.mainNonNpmBytes, `Main package non-npm size exceeds internal budget (${sizes.__main__}/${budgets.mainNonNpmBytes} bytes)`)
  for (const item of compiled.subPackages) {
    const limit = item.independent ? budgets.independentBytes : budgets.subPackageBytes
    const physicalSize = sumSizes(compiled.packages.get(item.root))
    assert(physicalSize <= limit, `Subpackage ${item.root} exceeds internal budget (${physicalSize}/${limit} bytes)`)
  }

  const totalNonNpmBytes = Object.values(sizes).reduce((total, size) => total + size, 0)
  assert(totalNonNpmBytes <= budgets.totalNonNpmBytes, `Compiled non-npm output exceeds total budget (${totalNonNpmBytes}/${budgets.totalNonNpmBytes} bytes)`)

  const reachableNpmFiles = collectReachableNpmFiles(distRoot)
  const reachableNpmBytes = sumSizes(reachableNpmFiles)
  const mainWithReachableNpmBytes = sizes.__main__ + reachableNpmBytes
  assert(
    mainWithReachableNpmBytes <= budgets.mainWithReachableNpmBytes,
    `Main package with reachable npm exceeds internal budget (${mainWithReachableNpmBytes}/${budgets.mainWithReachableNpmBytes} bytes)`,
  )

  const dependencyAwareSizes = {}
  for (const packageId of compiled.packages.keys()) {
    dependencyAwareSizes[packageId] = sumSizes(collectPackageRuntimeClosure(distRoot, appJson, packageId))
    assert(
      dependencyAwareSizes[packageId] <= budgets.dependencyAwarePackageBytes,
      `Package ${packageId} with reachable runtime dependencies exceeds internal budget (${dependencyAwareSizes[packageId]}/${budgets.dependencyAwarePackageBytes} bytes)`,
    )
  }

  return {
    sizes,
    totalNonNpmBytes,
    reachableNpmBytes,
    reachableNpmFileCount: reachableNpmFiles.size,
    mainWithReachableNpmBytes,
    dependencyAwareSizes,
  }
}
