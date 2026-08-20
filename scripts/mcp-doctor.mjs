#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const results = []

function check(name, ok, detail, required = true) {
  results.push({ name, ok, detail, required })
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath))
}

function collectAbsolutePaths(value, trail = []) {
  const hits = []
  if (typeof value === 'string') {
    if (value.startsWith('/') && !value.startsWith('./')) {
      hits.push(`${trail.join('.')}: ${value}`)
    }
    return hits
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...collectAbsolutePaths(item, [...trail, String(index)])))
    return hits
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      hits.push(...collectAbsolutePaths(item, [...trail, key]))
    }
  }
  return hits
}

const files = ['.mcp.json', '.cursor/mcp.json', 'config/mcporter.json']
for (const file of files) {
  check(`${file} exists`, exists(file), file)
  try {
    const json = readJson(file)
    check(`${file} JSON`, true, 'parsed')
    const abs = collectAbsolutePaths(json)
    check(`${file} relative paths`, abs.length === 0, abs.join('; ') || 'no absolute paths')
    const blob = JSON.stringify(json)
    check(`${file} no source-repo paths`, !blob.includes('ai-membership-miniprogram') && !blob.includes(['apps', 'showcase'].join('/')), file)
  }
  catch (error) {
    check(`${file} JSON`, false, error instanceof Error ? error.message : String(error))
  }
}

const mcp = readJson('.mcp.json')
const cursor = readJson('.cursor/mcp.json')
const mcporter = readJson('config/mcporter.json')
const weappServer = Object.values(mcp.mcpServers || {})[0]
check('weapp-vite wrapper exists', exists('scripts/mcp/weapp-vite.mjs'), 'scripts/mcp/weapp-vite.mjs')
check(
  'weapp-vite MCP command',
  weappServer?.command === 'node' && String(weappServer?.args?.[0] || '').includes('scripts/mcp/weapp-vite.mjs'),
  'starts via local wrapper',
)
check('editor MCP split', !mcp.mcpServers?.cloudbase && !cursor.mcpServers?.cloudbase, 'CloudBase stays on mcporter')
check('CloudBase MCP optional', Boolean(mcporter.mcpServers?.cloudbase), 'config/mcporter.json', false)
check('mcporter installed', exists('node_modules/mcporter/package.json') || exists('node_modules/.bin/mcporter'), 'pnpm install', false)
check('weapp-vite installed', exists('node_modules/weapp-vite/package.json'), 'pnpm install')

const requiredEnv = ['MINI_PROGRAM_APP_ID']
const optionalEnv = ['CLOUDBASE_ENV_ID', 'CLOUDBASE_API_KEY', 'WECHAT_PAY_MERCHANT_ID']
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
for (const key of [...requiredEnv, ...optionalEnv]) {
  check(`.env.example has ${key}`, envExample.includes(`${key}=`), key, key === 'MINI_PROGRAM_APP_ID')
}

for (const result of results) {
  const mark = result.ok ? 'PASS' : result.required ? 'FAIL' : 'WARN'
  console.log(`${mark.padEnd(4)}  ${result.name.padEnd(28)} ${result.detail}`)
}

if (results.some(result => result.required && !result.ok)) {
  process.exitCode = 1
}
