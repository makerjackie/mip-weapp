#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { detectEmbeddedCredentials } from './lib/security-patterns.mjs'

const root = path.resolve(import.meta.dirname, '..')
const patterns = [{ id: 'real-appid', source: /wx[0-9a-f]{16}/i }]

const allowAppIdFiles = new Set([
  'project.config.json',
  '.env.example',
  'docs/SECURITY.md',
  'docs/CUSTOMIZATION.md',
  'scripts/setup-local.mjs',
  'scripts/project-init.mjs',
  'scripts/mcp-doctor.mjs',
  'scripts/security-check.mjs',
])

function filesToScan() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`Unable to list repository files: ${result.stderr.trim()}`)
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(file => path.join(root, file))
    .filter(file => fs.existsSync(file))
}

const hits = []
for (const file of filesToScan()) {
  if (!/\.(?:md|json|ts|js|mjs|cjs|env|example|yml|yaml|txt|pem|key)$/.test(file) && path.basename(file) !== '.env.example') {
    continue
  }
  const relative = path.relative(root, file)
  const text = fs.readFileSync(file, 'utf8')
  for (const id of detectEmbeddedCredentials(text)) {
    hits.push(`${relative}: ${id}`)
  }
  for (const pattern of patterns) {
    if (pattern.id === 'real-appid') {
      if (allowAppIdFiles.has(relative) || relative.startsWith('tests/') || relative.includes('/tests/')) {
        continue
      }
      const matches = text.match(pattern.source) || []
      for (const match of matches) {
        if (match === 'touristappid' || match.startsWith('wx_') || match.includes('your_mini_program')) {
          continue
        }
        if (/wx(?:fromapp|directapp|resource)/i.test(match)) {
          continue
        }
        hits.push(`${relative}: ${pattern.id} ${match}`)
      }
      continue
    }
  }
}

if (hits.length) {
  throw new Error(`Security check failed:\n${hits.join('\n')}`)
}
console.log('Security check passed')
