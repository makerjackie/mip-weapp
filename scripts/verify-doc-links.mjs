#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const roots = [
  'AGENTS.md',
  'CHANGELOG.md',
  'DESIGN.md',
  'README.md',
  'docs',
  '.agents/skills',
]

function markdownFiles(relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) {
    return []
  }
  const stat = fs.statSync(absolutePath)
  if (stat.isFile()) {
    return relativePath.endsWith('.md') ? [relativePath] : []
  }
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name)
    return entry.isDirectory() ? markdownFiles(child) : entry.name.endsWith('.md') ? [child] : []
  })
}

const failures = []
for (const source of [...new Set(roots.flatMap(markdownFiles))]) {
  const markdown = fs.readFileSync(path.join(root, source), 'utf8')
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '')
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) {
      continue
    }
    target = target.split('#', 1)[0].split('?', 1)[0]
    try {
      target = decodeURIComponent(target)
    }
    catch {
      failures.push(`${source}: invalid URL encoding in ${match[1]}`)
      continue
    }
    const resolved = path.resolve(path.dirname(path.join(root, source)), target)
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) {
      failures.push(`${source}: missing ${match[1]}`)
    }
  }
}

if (failures.length) {
  throw new Error(`Documentation link contract failed:\n${failures.join('\n')}`)
}
console.log('Documentation links passed')
