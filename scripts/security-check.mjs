#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const patterns = [
  { id: 'app-secret', source: /appsecret|APP_SECRET/i },
  { id: 'api-v3-key', source: /WECHATPAY.*KEY|API_V3_KEY|mch_private_key/i },
  { id: 'private-key-block', source: /BEGIN (RSA )?PRIVATE KEY/ },
  { id: 'access-token', source: /access_token\s*[:=]/i },
  { id: 'real-appid', source: /wx[0-9a-f]{16}/i },
  { id: 'pem', source: /\.pem\b/ },
]

const allowAppIdFiles = new Set([
  'project.config.json',
  '.env.example',
  'docs/GETTING_STARTED.md',
  'docs/SECURITY.md',
  'docs/CUSTOMIZATION.md',
  'scripts/setup-local.mjs',
  'scripts/project-init.mjs',
  'scripts/mcp-doctor.mjs',
  'scripts/security-check.mjs',
])

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.git', '.weapp-vite', '.tmp'].includes(entry.name)) {
      return []
    }
    const child = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

const hits = []
for (const file of walk(root)) {
  if (!/\.(?:md|json|ts|js|mjs|cjs|env|example|yml|yaml|txt)$/.test(file) && path.basename(file) !== '.env.example') {
    continue
  }
  const relative = path.relative(root, file)
  const text = fs.readFileSync(file, 'utf8')
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
    if (pattern.source.test(text) && !relative.startsWith('docs/') && !relative.startsWith('scripts/security-check')) {
      if (pattern.id === 'pem' && relative === '.gitignore') {
        continue
      }
      if (
        pattern.id === 'app-secret'
        && (
          relative.startsWith('tests/')
          || relative === 'config/runtime-pages.json'
        )
      ) {
        continue
      }
      hits.push(`${relative}: ${pattern.id}`)
    }
  }
}

if (hits.length) {
  throw new Error(`Security check failed:\n${hits.join('\n')}`)
}
console.log('Security check passed')
