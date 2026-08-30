import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ignoredDirectoryNames = new Set([
  '.git',
  '.tmp',
  'coverage',
  'dist',
  'node_modules',
])

function assertInside(cwd, candidate) {
  const relative = path.relative(cwd, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Verification root escapes cwd: ${candidate}`)
  }
}

function collectJavaScript(cwd, relativeRoot) {
  const absoluteRoot = path.resolve(cwd, relativeRoot)
  assertInside(cwd, absoluteRoot)
  if (!fs.existsSync(absoluteRoot)) {
    return []
  }

  const files = []
  const stack = [absoluteRoot]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          stack.push(absolute)
        }
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.relative(cwd, absolute))
      }
    }
  }
  return files.sort()
}

function runNode(cwd, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`node ${args.join(' ')} failed`)
  }
}

/**
 * Verify only repository-owned JavaScript behind a small module interface.
 * Deployment dependencies are deliberately excluded: package managers own
 * their syntax and scanning them makes case verification scale with vendors.
 */
export function verifyNodeSources({
  cwd,
  sourceRoots,
  testRoots,
  env = {},
}) {
  const normalizedCwd = path.resolve(cwd)
  const sourceFiles = [...new Set(
    sourceRoots.flatMap(root => collectJavaScript(normalizedCwd, root)),
  )]
  const testFiles = [...new Set(
    testRoots.flatMap(root => collectJavaScript(normalizedCwd, root)),
  )].filter(file => file.endsWith('.test.js'))

  if (!sourceFiles.length) {
    throw new Error('No owned JavaScript sources found')
  }
  if (!testFiles.length) {
    throw new Error('No cloud function tests found')
  }

  for (const file of sourceFiles) {
    runNode(normalizedCwd, ['--check', file], env)
  }
  // Keep the large Cloud Function suite deterministic on fixed-size CI runners.
  runNode(normalizedCwd, ['--test', '--test-concurrency=1', ...testFiles], env)

  return {
    sourceCount: sourceFiles.length,
    testCount: testFiles.length,
  }
}
