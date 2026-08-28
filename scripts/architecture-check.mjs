#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const localResearchInputs = new Set([
  'docs/research/legacy-mip-app',
])
const patterns = [
  { id: 'showcase', source: ['apps', 'showcase'].join('/') },
  { id: 'membership-example', source: ['examples', 'ai-membership'].join('/') },
  { id: 'parent-pnpm', source: ['pnpm --dir ', '../', '..'].join('') },
  { id: 'parent-scripts', source: ['../', '../scripts'].join('') },
  { id: 'macos-users', source: ['/', 'Users', '/'].join('') },
]

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.git', '.weapp-vite', '.tmp', '.screenshots'].includes(entry.name)) {
      return []
    }
    if (entry.name === 'pnpm-lock.yaml') {
      return []
    }
    const child = path.join(dir, entry.name)
    if (entry.isDirectory() && localResearchInputs.has(path.relative(root, child))) {
      return []
    }
    return entry.isDirectory() ? walk(child) : [child]
  })
}

const hits = []
for (const file of walk(root)) {
  if (!/\.(?:md|mdx|json|ts|js|mjs|cjs|yml|yaml|txt)$/.test(file)) {
    continue
  }
  const text = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file)
  for (const pattern of patterns) {
    if (text.includes(pattern.source)) {
      hits.push(`${relative}: ${pattern.id}`)
    }
  }
}

const settingsYamlName = ['pnpm', 'workspace.yaml'].join('-')
const settingsYamlPath = path.join(root, settingsYamlName)
if (fs.existsSync(settingsYamlPath)) {
  const settingsYaml = fs.readFileSync(settingsYamlPath, 'utf8')
  for (const expected of ['admin-web', 'packages/*']) {
    if (!settingsYaml.includes(`- ${expected}`)) {
      hits.push(`${settingsYamlName}: missing-workspace ${expected}`)
    }
  }
}

const allowedWorkspaceConsumers = new Set(['package.json', 'admin-web/package.json'])
for (const relative of allowedWorkspaceConsumers) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
  const sections = [manifest.dependencies || {}, manifest.devDependencies || {}]
  for (const [name, version] of sections.flatMap(section => Object.entries(section))) {
    if (String(version).startsWith('workspace:') && name !== '@mip/admin-contracts') {
      hits.push(`${relative}: unsupported-workspace-dependency ${name}`)
    }
  }
}

const webSourceRoot = path.join(root, 'admin-web', 'src')
if (fs.existsSync(webSourceRoot)) {
  for (const file of walk(webSourceRoot)) {
    if (!/\.(?:ts|tsx|js|jsx)$/.test(file)) {
      continue
    }
    const text = fs.readFileSync(file, 'utf8')
    const relative = path.relative(root, file)
    if (/\bwx\s*\.|tdesign-miniprogram|src\/(?:pages|packages)|\.wxml\b/.test(text)) {
      hits.push(`${relative}: web-mini-program-dependency`)
    }
  }
}

if (hits.length) {
  throw new Error(`Architecture leftovers remain:\n${hits.join('\n')}`)
}
console.log('Architecture boundary check passed')
