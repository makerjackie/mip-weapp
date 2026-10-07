/** Upload only the built admin SPA into an isolated existing hosting prefix. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  CLOUDFLARE_METADATA_BASENAMES,
  collectHostingListing,
  hostingFileCount,
  hostingKeysOutsidePrefix,
  hostingMetadataLeaks,
  manifestListingGaps,
  sha256File,
  treeGapsAgainstListing,
} from './lib/admin-hosting-readback.mjs'
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
const fetchListingPage = marker => call('queryHosting', { action: 'findFiles', prefix, maxKeys: 1000, ...(marker ? { marker } : {}) })
save('inventory.private.json', fetchListingPage(''))
const snapshot = fs.mkdtempSync(path.join(evidence, 'source-'))
try {
  copyBuiltAssets(source, path.join(snapshot, 'dist'))
  const manifest = assetManifest(path.join(snapshot, 'dist'))
  const deployed = call('manageHosting', { action: 'upload', localPath: path.join(snapshot, 'dist'), cloudPath: prefix }, 300000)
  save('deploy.private.json', deployed)
  if (deployed?.data?.cloudPath && deployed.data.cloudPath !== prefix) {
    throw new Error(`Static upload escaped the isolated prefix: ${deployed.data.cloudPath}`)
  }

  // Readback #1: cloud-side listing of everything now under the isolated prefix.
  const listing = collectHostingListing(fetchListingPage)
  save('readback-listing.private.json', listing)
  if (listing.degraded) {
    console.warn('[readback] listing fell back to legacy flat data.files; result.Contents missing from this MCP response')
  }
  const outsidePrefix = hostingKeysOutsidePrefix(listing, prefix)
  if (outsidePrefix.length) {
    throw new Error(`Hosting listing escaped the isolated prefix: ${outsidePrefix.join(', ')}`)
  }
  const metadataLeaks = hostingMetadataLeaks(listing, prefix)
  if (metadataLeaks.length) {
    throw new Error(`Cloudflare metadata or source map published under ${prefix}: ${metadataLeaks.join(', ')}`)
  }
  const gaps = manifestListingGaps(manifest, listing, prefix)
  if (gaps.length) {
    throw new Error(`Deployed listing missing or resized assets: ${gaps.join('; ')}`)
  }

  // Readback #2: full directory download, hashed as a tree. The SDK fetches
  // each file over the hosting CDN at high concurrency and silently swallows
  // individual failures, so the tree is audited against the cloud listing and
  // dropped keys are refetched sequentially before hashing. Download is local
  // verification only. Never delete or reconfigure shared hosting.
  const downloaded = path.join(snapshot, 'readback')
  fs.mkdirSync(downloaded, { recursive: true })
  const directoryDownload = call('manageHosting', { action: 'downloadDirectory', localPath: downloaded, cloudPath: prefix }, 300000)
  const dropped = treeGapsAgainstListing(assetManifest(downloaded), listing, prefix)
  const topUp = path.join(snapshot, 'topup')
  let directoryTopUps = 0
  for (const key of dropped) {
    const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key
    const target = path.join(topUp, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    call('manageHosting', { action: 'downloadFile', cloudPath: key, localPath: target }, 120000)
    const entry = listing.files.find(item => item.key === key)
    if (!entry || fs.statSync(target).size !== entry.bytes) {
      throw new Error(`Directory readback top-up size mismatch: ${key}`)
    }
    fs.cpSync(target, path.join(downloaded, relative))
    directoryTopUps += 1
  }
  save('directory-download.private.json', { response: directoryDownload, droppedByDirectoryPass: dropped, directoryTopUps })
  const actual = assetManifest(downloaded)
  const stillMissing = treeGapsAgainstListing(actual, listing, prefix)
  if (stillMissing.length) {
    throw new Error(`Directory readback is missing cloud files: ${stillMissing.join(', ')}`)
  }
  for (const expected of manifest) {
    const matches = actual.filter(file => file.path === expected.path || file.path === `${prefix}${expected.path}`)
    if (matches.length !== 1 || matches[0].sha256 !== expected.sha256 || matches[0].bytes !== expected.bytes) {
      throw new Error(`Static asset readback mismatch: ${expected.path}`)
    }
  }

  // Readback #3: per-file download sha256, kept as double insurance against a
  // directory download that silently succeeds with partial or stale content.
  const perFile = path.join(snapshot, 'per-file')
  for (const expected of manifest) {
    const target = path.join(perFile, expected.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    call('manageHosting', { action: 'downloadFile', cloudPath: `${prefix}${expected.path}`, localPath: target }, 120000)
    if (sha256File(target) !== expected.sha256) {
      throw new Error(`Per-file readback sha256 mismatch: ${expected.path}`)
    }
  }

  const localMetadataLeaks = manifest.map(file => file.path).filter((relative) => {
    return relative.endsWith('.map') || CLOUDFLARE_METADATA_BASENAMES.includes(relative.split('/').at(-1))
  })
  if (localMetadataLeaks.length) {
    throw new Error(`Built assets contain Cloudflare metadata or source maps: ${localMetadataLeaks.join(', ')}`)
  }
  save('verified.private.json', {
    prefix,
    files: manifest,
    verifiedAt: new Date().toISOString(),
    listingSource: listing.source,
    listingFiles: hostingFileCount(listing),
    directoryReadbackFiles: actual.length,
    directoryTopUps,
    perFileVerified: manifest.length,
  })
  console.log(JSON.stringify({
    prefix,
    filesVerified: manifest.length,
    listingSource: listing.source,
    listingFiles: hostingFileCount(listing),
    directoryReadbackFiles: actual.length,
    directoryTopUps,
    perFileVerified: manifest.length,
    status: 'VERIFIED',
    cloudflareUnchanged: true,
    sharedRootUnchanged: true,
    evidence: path.relative(root, evidence),
  }))
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
