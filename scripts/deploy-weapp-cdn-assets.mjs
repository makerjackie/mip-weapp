/**
 * Upload weapp CDN image assets (assets/cdn) under the admin-console static hosting prefix.
 *
 * The default tcloudbaseapp.com hosting domain refuses some egress regions with HTTP 418
 * (verified 2026-10-14), while the admin console custom domain (brand.adminConsoleDomain)
 * fronts the same static store via a gateway rewrite of `/*` to `mip-admin-console/*` and
 * serves verified 200s. Weapp art therefore lives under `mip-admin-console/mip-weapp-assets/`
 * and is referenced as `https://admin.mip.cool/mip-weapp-assets/...`.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  collectHostingListing,
  hostingFileCount,
  hostingKeysOutsidePrefix,
} from './lib/admin-hosting-readback.mjs'
import { bindAndRequireCloudbaseEnvironment, callCloudbase, loadCaseEnv } from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const prefix = 'mip-admin-console/mip-weapp-assets/'
resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
if (!env.CLOUDBASE_ENV_ID || !process.argv.includes(`--confirm-env=${env.CLOUDBASE_ENV_ID}`) || !process.argv.includes('--confirm-prefix=mip-admin-console/mip-weapp-assets/')) {
  throw new Error('Exact CloudBase environment and static prefix confirmations required')
}
const source = path.join(root, 'assets', 'cdn')
if (!fs.existsSync(source)) {
  throw new Error('assets/cdn is missing; nothing to upload')
}
bindAndRequireCloudbaseEnvironment(root, env.CLOUDBASE_ENV_ID)

function manifestOf(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) {
      return manifestOf(directory, file)
    }
    if (!entry.isFile()) {
      throw new Error(`Unexpected CDN asset type: ${file}`)
    }
    if (!/\.(?:png|jpg|jpeg|webp)$/i.test(entry.name)) {
      throw new Error(`CDN assets must be images: ${file}`)
    }
    const bytes = fs.readFileSync(path.join(directory, file))
    return [{ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
  }).sort((a, b) => a.path.localeCompare(b.path))
}

const manifest = manifestOf(source)
if (!manifest.length) {
  throw new Error('assets/cdn is empty; nothing to upload')
}

function call(tool, args, timeout = 120000) {
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

const fetchListingPage = marker => call('queryHosting', { action: 'findFiles', prefix, maxKeys: 1000, ...(marker ? { marker } : {}) })

const deployed = call('manageHosting', { action: 'upload', localPath: source, cloudPath: prefix }, 300000)
if (deployed?.data?.cloudPath && deployed.data.cloudPath !== prefix) {
  throw new Error(`Static upload escaped the isolated prefix: ${deployed.data.cloudPath}`)
}

// Readback #1: cloud listing under the isolated prefix must contain every uploaded file
// with the uploaded byte size, and nothing outside the prefix.
const listing = collectHostingListing(fetchListingPage)
const outsidePrefix = hostingKeysOutsidePrefix(listing, prefix)
if (outsidePrefix.length) {
  throw new Error(`Hosting listing escaped the isolated prefix: ${outsidePrefix.join(', ')}`)
}
const listingByPath = new Map(listing.files.map(item => [item.key.startsWith(prefix) ? item.key.slice(prefix.length) : item.key, item]))
for (const expected of manifest) {
  const entry = listingByPath.get(expected.path)
  if (!entry || entry.bytes !== expected.bytes) {
    throw new Error(`Deployed listing missing or resized asset: ${expected.path}`)
  }
}

// Readback #2: per-file download over the hosting CDN, sha256 against the local manifest.
const verifyDir = fs.mkdtempSync(path.join(root, '.tmp', 'cdn-assets-verify-'))
try {
  for (const expected of manifest) {
    const target = path.join(verifyDir, expected.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    call('manageHosting', { action: 'downloadFile', cloudPath: `${prefix}${expected.path}`, localPath: target }, 120000)
    const bytes = fs.readFileSync(target)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (bytes.length !== expected.bytes || sha256 !== expected.sha256) {
      throw new Error(`CDN asset readback mismatch: ${expected.path}`)
    }
  }
}
finally {
  fs.rmSync(verifyDir, { recursive: true, force: true })
}

console.log(JSON.stringify({
  prefix,
  filesVerified: manifest.length,
  listingFiles: hostingFileCount(listing),
  publicUrlBase: `https://admin.mip.cool/mip-weapp-assets/`,
  status: 'VERIFIED',
}))
