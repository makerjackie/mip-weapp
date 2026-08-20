#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getProject, readEnv, readJson } from './lib/project.mjs'

const example = getProject()
const env = readEnv(path.join(example.root, '.env.local'))
const appid = env.MINI_PROGRAM_APP_ID || ''
const optional = process.argv.includes('--optional')

if (!/^wx[0-9a-f]{16}$/i.test(appid)) {
  const message = '缺少有效 MINI_PROGRAM_APP_ID；请从 .env.example 创建 .env.local，或使用 touristappid 仅浏览 UI'
  if (optional) {
    console.warn(`[setup:local] ${message}`)
    process.exit(0)
  }
  throw new Error(message)
}
if (env.APP_NAMESPACE && env.APP_NAMESPACE !== example.namespace) {
  throw new Error('APP_NAMESPACE must match config/project.json')
}
if (env.CLOUDBASE_RESOURCE_APP_ID && !env.CLOUDBASE_ENV_ID) {
  throw new Error('CLOUDBASE_RESOURCE_APP_ID requires CLOUDBASE_ENV_ID')
}

const privateConfigPath = path.join(example.root, 'project.private.config.json')
const existing = fs.existsSync(privateConfigPath) ? readJson(privateConfigPath) : {}
const routes = example.routes.map(route => ({
  name: route.name,
  pathName: route.pathName,
  query: route.query || '',
  scene: null,
}))
const config = {
  ...existing,
  appid,
  projectname: env.MINI_PROGRAM_NAME || example.name,
  setting: { ...existing.setting, compileHotReLoad: true },
  condition: {
    ...existing.condition,
    miniprogram: { ...existing.condition?.miniprogram, list: routes },
  },
  libVersion: '3.15.2',
}

fs.writeFileSync(privateConfigPath, `${JSON.stringify(config, null, 2)}\n`)
console.log('[setup:local] DevTools private config updated; no identity value was printed')
