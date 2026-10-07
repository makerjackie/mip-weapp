/** Readback parsing for CloudBase static hosting listings under @cloudbase/cloudbase-mcp. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'

// Newer MCP versions (>=2.32.x) return the raw COS ListBucket payload in
// `data.result` and leave `data.files` empty (their normalizer expects an
// array). Older versions returned the flat file array directly. Both shapes
// must keep verifying; only the fallback may announce a degradation.
export const CLOUDFLARE_METADATA_BASENAMES = ['_headers', '_redirects', '_worker.js', '_routes.json']

function truthyFlag(value) {
  return value === true || String(value).trim().toLowerCase() === 'true'
}

function listingEntry(key, bytes, etag) {
  if (typeof key !== 'string' || !key) {
    return null
  }
  return { key, bytes: Number(bytes ?? 0), etag: typeof etag === 'string' ? etag : '' }
}

export function parseHostingListingPage(response) {
  const data = response?.data
  const nested = data?.result
  if (nested && Array.isArray(nested.Contents)) {
    const files = nested.Contents
      .map(item => listingEntry(item?.Key, item?.Size, item?.ETag))
      .filter(Boolean)
    const lastKey = files.at(-1)?.key ?? ''
    return {
      source: 'result-contents',
      degraded: false,
      files,
      truncated: truthyFlag(nested.IsTruncated),
      nextMarker: typeof nested.NextMarker === 'string' ? nested.NextMarker : lastKey,
    }
  }
  if (Array.isArray(data?.files)) {
    // Legacy flat listing. Old responses were always complete arrays, so no pagination.
    return {
      source: 'legacy-files',
      degraded: true,
      files: data.files
        .map(item => listingEntry(item?.Key ?? item?.key, item?.Size ?? item?.size, item?.ETag ?? item?.etag))
        .filter(Boolean),
      truncated: false,
      nextMarker: '',
    }
  }
  return null
}

export function collectHostingListing(fetchPage, { maxPages = 20 } = {}) {
  const raw = []
  let marker = ''
  let listing = null
  for (let page = 0; page < maxPages; page += 1) {
    const response = fetchPage(marker)
    const parsed = parseHostingListingPage(response)
    if (!parsed) {
      throw new Error('Unrecognized CloudBase hosting listing shape; expected result.Contents or a flat files array')
    }
    raw.push(response)
    listing = listing
      ? { ...listing, files: [...listing.files, ...parsed.files], truncated: parsed.truncated, nextMarker: parsed.nextMarker }
      : parsed
    if (!listing.truncated || !parsed.files.length) {
      break
    }
    const next = listing.nextMarker || listing.files.at(-1).key
    if (!next || next === marker) {
      throw new Error('CloudBase hosting listing pagination did not advance')
    }
    marker = next
  }
  if (!listing) {
    throw new Error('CloudBase hosting listing returned no pages')
  }
  const byKey = new Map()
  for (const entry of listing.files) {
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry)
    }
  }
  return { source: listing.source, degraded: listing.degraded, files: [...byKey.values()], raw }
}

export function hostingFileKeys(listing) {
  // COS keeps zero-byte directory marker keys ending in `/`; they are not deployable files.
  return listing.files.filter(entry => !entry.key.endsWith('/'))
}

export function hostingFileCount(listing) {
  return hostingFileKeys(listing).length
}

export function hostingKeysOutsidePrefix(listing, prefix) {
  return hostingFileKeys(listing).map(entry => entry.key).filter(key => !key.startsWith(prefix))
}

export function hostingMetadataLeaks(listing, prefix) {
  return hostingFileKeys(listing)
    .map(entry => entry.key)
    .filter((key) => {
      if (!key.startsWith(prefix)) {
        return false
      }
      const relative = key.slice(prefix.length)
      return relative.endsWith('.map') || CLOUDFLARE_METADATA_BASENAMES.includes(relative.split('/').at(-1))
    })
}

/** Every manifest file must appear in the cloud listing once, with identical byte length. */
export function manifestListingGaps(manifest, listing, prefix) {
  const sizes = new Map(hostingFileKeys(listing).map(entry => [entry.key, entry.bytes]))
  return manifest
    .filter((file) => {
      const key = `${prefix}${file.path}`
      return !sizes.has(key) || sizes.get(key) !== file.bytes
    })
    .map(file => `${file.path} (listing bytes=${sizes.get(`${prefix}${file.path}`) ?? 'missing'}, local=${file.bytes})`)
}

/** Cloud keys that the downloaded tree is missing entirely or holds at the wrong byte length. */
export function treeGapsAgainstListing(treeManifest, listing, prefix) {
  const local = new Map(treeManifest.map(file => [file.path, file]))
  return hostingFileKeys(listing)
    .filter((entry) => {
      const file = local.get(entry.key.startsWith(prefix) ? entry.key.slice(prefix.length) : entry.key)
      return !file || file.bytes !== entry.bytes
    })
    .map(entry => entry.key)
}

export function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}
