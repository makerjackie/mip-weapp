/** Upload only the built admin SPA into an isolated existing hosting prefix. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { bindAndRequireCloudbaseEnvironment, callCloudbase, loadCaseEnv } from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const prefix = 'mip-admin-console/'
resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
if (!env.CLOUDBASE_ENV_ID || !process.argv.includes(`--confirm-env=${env.CLOUDBASE_ENV_ID}`) || !process.argv.includes('--confirm-prefix=mip-admin-console/')) {
  throw new Error('Exact CloudBase environment and static prefix confirmations required')
}
const source = path.join(root, 'admin-web/dist')
if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error('Build the real admin frontend before static deployment')
}
bindAndRequireCloudbaseEnvironment(root, env.CLOUDBASE_ENV_ID)
const evidence = path.join(root, '.tmp/admin-cloudbase-static')
fs.mkdirSync(evidence, { recursive: true })
const inventory = call('queryHosting', { action: 'findFiles', prefix, maxKeys: 1000 })
save('inventory.private.json', inventory)
const snapshot = fs.mkdtempSync(path.join(evidence, 'source-'))
try {
  copyBuiltAssets(source, path.join(snapshot, 'dist'))
  const manifest = assetManifest(path.join(snapshot, 'dist'))
  const deployed = call('manageHosting', { action: 'upload', localPath: path.join(snapshot, 'dist'), cloudPath: prefix }, 300000)
  save('deploy.private.json', deployed)
  const downloaded = path.join(snapshot, 'readback')
  fs.mkdirSync(downloaded, { recursive: true })
  // Download is local verification only. Never delete or reconfigure shared hosting.
  call('manageHosting', { action: 'downloadDirectory', localPath: downloaded, cloudPath: prefix }, 300000)
  const actual = assetManifest(downloaded)
  for (const expected of manifest) {
    const matches = actual.filter(file => file.path === expected.path || file.path === `${prefix}${expected.path}`)
    if (matches.length !== 1 || matches[0].sha256 !== expected.sha256 || matches[0].bytes !== expected.bytes) {
      throw new Error(`Static asset readback mismatch: ${expected.path}`)
    }
  }
  save('verified.private.json', { prefix, files: manifest, verifiedAt: new Date().toISOString() })
  console.log(JSON.stringify({ prefix, filesVerified: manifest.length, status: 'VERIFIED', cloudflareUnchanged: true, sharedRootUnchanged: true, evidence: path.relative(root, evidence) }))
}
finally {
  fs.rmSync(snapshot, { recursive: true, force: true })
}

function copyBuiltAssets(directory, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.') || /(?:\.env|\.pem|\.key)$/i.test(entry.name)) {
      throw new Error('Unexpected private or linked file in frontend build')
    }
    // Vite may emit source maps locally; never publish those or Cloudflare metadata.
    if (entry.name.endsWith('.map') || ['_headers', '_redirects', '_worker.js', '_routes.json'].includes(entry.name)) {
      continue
    }
    const from = path.join(directory, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      copyBuiltAssets(from, to)
    }
    else if (entry.isFile()) {
      fs.copyFileSync(from, to)
    }
    else {
      throw new Error('Unexpected asset file type')
    }
  }
}
function save(file, data) {
  const target = path.join(evidence, file)
  fs.writeFileSync(target, JSON.stringify(data), { mode: 0o600 })
  fs.chmodSync(target, 0o600)
}
function call(tool, args, timeout) {
  try {
    const result = callCloudbase(root, tool, args, timeout)
    if (result?.success === false || result?.isError) {
      throw new Error('Rejected')
    }
    return result
  }
  catch {
    throw new Error(`CloudBase static ${args.action} failed; no credentials are included in this diagnostic`)
  }
}

function assetManifest(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) {
      return assetManifest(directory, file)
    }
    if (!entry.isFile()) {
      throw new Error('Unexpected verification asset type')
    }
    const bytes = fs.readFileSync(path.join(directory, file))
    return [{ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
  })
}
