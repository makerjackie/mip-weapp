#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const current = process.argv[index]
  if (!current.startsWith('--')) {
    continue
  }
  const [flag, inline] = current.slice(2).split('=')
  const value = inline ?? (process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[++index] : 'true')
  args.set(flag, value)
}

const dryRun = args.has('dry-run')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function write(relativePath, contents) {
  if (dryRun) {
    console.log(`[dry-run] would write ${relativePath}`)
    return
  }
  fs.writeFileSync(path.join(root, relativePath), contents)
}

function parseEnv(text) {
  return text.split(/\r?\n/).reduce((result, line) => {
    const match = line.trim().match(/^([A-Z_]\w*)=(.*)$/i)
    if (match) {
      result[match[1]] = match[2]
    }
    return result
  }, {})
}

function serializeEnv(values, template) {
  const known = new Set(Object.keys(values))
  const lines = template.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z_]\w*)=/i)
    if (!match) {
      return line
    }
    known.delete(match[1])
    return `${match[1]}=${values[match[1]] ?? ''}`
  })
  for (const key of known) {
    lines.push(`${key}=${values[key]}`)
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

const name = args.get('name')
const slug = args.get('slug')
const appid = args.get('appid')
const envId = args.get('env-id')
const namespace = args.get('namespace')

const brandPath = 'src/config/brand.ts'
const brand = read(brandPath)
let nextBrand = brand
if (name) {
  nextBrand = nextBrand.replace(/productName: '[^']*'/, `productName: ${JSON.stringify(name).replaceAll('"', '\'')}`)
}
if (nextBrand !== brand) {
  write(brandPath, nextBrand)
}

const project = JSON.parse(read('config/project.json'))
const nextProject = {
  ...project,
  name: name || project.name,
  slug: slug || project.slug,
  namespace: namespace || project.namespace,
}
write('config/project.json', `${JSON.stringify(nextProject, null, 2)}\n`)

const appJson = JSON.parse(read('src/app.json'))
if (name) {
  appJson.window = { ...appJson.window, navigationBarTitleText: name }
  write('src/app.json', `${JSON.stringify(appJson, null, 2)}\n`)
}

const envTemplate = read('.env.example')
const envPath = path.join(root, '.env.local')
const existingEnv = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : parseEnv(envTemplate)
const nextEnv = {
  ...existingEnv,
  MINI_PROGRAM_NAME: name || existingEnv.MINI_PROGRAM_NAME || project.name,
  APP_NAMESPACE: namespace || existingEnv.APP_NAMESPACE || project.namespace,
}
if (appid) {
  nextEnv.MINI_PROGRAM_APP_ID = appid
  nextEnv.MEMBERSHIP_ALLOWED_APP_IDS = appid
}
if (envId) {
  nextEnv.CLOUDBASE_ENV_ID = envId
}
if (!dryRun) {
  fs.writeFileSync(envPath, serializeEnv(nextEnv, envTemplate))
}
else {
  console.log('[dry-run] would update .env.local without printing secrets')
}

if (appid && /^wx[0-9a-f]{16}$/i.test(appid)) {
  const privatePath = path.join(root, 'project.private.config.json')
  const existing = fs.existsSync(privatePath) ? JSON.parse(fs.readFileSync(privatePath, 'utf8')) : {}
  write('project.private.config.json', `${JSON.stringify({
    ...existing,
    appid,
    projectname: nextEnv.MINI_PROGRAM_NAME,
  }, null, 2)}\n`)
}

console.log(dryRun ? 'project:init dry-run complete' : 'project:init complete; secrets were not printed')
