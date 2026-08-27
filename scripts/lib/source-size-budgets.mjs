import fs from 'node:fs'
import path from 'node:path'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function assertNoSymlinkSegments(root, target) {
  let current = root
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (!fs.existsSync(current)) {
      break
    }
    assert(!fs.lstatSync(current).isSymbolicLink(), `Source size budget target cannot traverse a symlink: ${target}`)
  }
}

function lineCount(source) {
  const normalized = String(source).replace(/\r\n?/g, '\n').replace(/\n$/, '')
  return normalized ? normalized.split('\n').length : 0
}

export function assertSourceSizeBudgets(root, configPath = 'config/source-size-budgets.json') {
  const absoluteConfigPath = path.resolve(root, configPath)
  assert(isInside(root, absoluteConfigPath), 'Source size budget config must stay inside the repository')
  const config = JSON.parse(fs.readFileSync(absoluteConfigPath, 'utf8'))
  assert(config?.schemaVersion === 1, 'Source size budget schemaVersion must be 1')
  assert(Array.isArray(config.entries) && config.entries.length > 0, 'Source size budgets must contain entries[]')

  const seen = new Set()
  const results = config.entries.map((entry) => {
    assert(entry && typeof entry === 'object', 'Source size budget entry must be an object')
    assert(typeof entry.path === 'string' && entry.path.trim(), 'Source size budget entry path is required')
    assert(Number.isInteger(entry.maxLines) && entry.maxLines > 0, `Invalid source size budget: ${entry.path}`)
    assert(typeof entry.reason === 'string' && entry.reason.trim(), `Source size budget reason is required: ${entry.path}`)
    const relativePath = entry.path.replaceAll('\\', '/')
    const absolutePath = path.resolve(root, relativePath)
    assert(isInside(root, absolutePath), `Source size budget escapes the repository: ${entry.path}`)
    assertNoSymlinkSegments(root, absolutePath)
    assert(!seen.has(relativePath), `Duplicate source size budget: ${entry.path}`)
    seen.add(relativePath)
    assert(fs.existsSync(absolutePath), `Source size budget target is missing: ${entry.path}`)
    assert(!fs.lstatSync(absolutePath).isSymbolicLink(), `Source size budget target cannot be a symlink: ${entry.path}`)
    assert(fs.statSync(absolutePath).isFile(), `Source size budget target must be a file: ${entry.path}`)
    const actualLines = lineCount(fs.readFileSync(absolutePath, 'utf8'))
    assert(actualLines <= entry.maxLines, `${entry.path} exceeds source size budget (${actualLines}/${entry.maxLines} lines)`)
    return { path: relativePath, actualLines, maxLines: entry.maxLines }
  })
  return { schemaVersion: config.schemaVersion, entries: results }
}
