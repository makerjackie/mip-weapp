import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it } from 'vitest'
import {
  collectHostingListing,
  hostingKeysOutsidePrefix,
  hostingMetadataLeaks,
  manifestListingGaps,
  parseHostingListingPage,
  sha256File,
  treeGapsAgainstListing,
} from '../scripts/lib/admin-hosting-readback.mjs'

// Captured from a real @cloudbase/cloudbase-mcp@2.32.3 queryHosting(action="findFiles") page.
const nestedPage = {
  success: true,
  data: {
    action: 'findFiles',
    prefix: 'mip-admin-console/',
    maxKeys: 1000,
    files: [],
    result: {
      Name: 'bucket',
      Prefix: 'mip-admin-console/',
      Marker: '',
      MaxKeys: '1000',
      IsTruncated: 'false',
      Contents: [
        { Key: 'mip-admin-console/404.html', LastModified: '2026-10-05T17:34:14.000Z', ETag: '"2c71ebc5b1e13efdf8c89272b36a111d"', Size: '465', StorageClass: 'STANDARD' },
        { Key: 'mip-admin-console/assets/', ETag: '"d41d8cd98f00b204e9800998ecf8427e"', Size: '0', StorageClass: 'STANDARD' },
        { Key: 'mip-admin-console/assets/index.js', ETag: '"abc"', Size: '1127668', StorageClass: 'STANDARD' },
      ],
      CommonPrefixes: [],
      RequestId: 'req',
    },
  },
  message: '已按前缀 `mip-admin-console/` 查询静态托管文件，共 0 个。',
}
const manifest = [
  { path: '404.html', bytes: 465, sha256: 'cf81cd76f5d089408ef0d38c9caa98fc1fff0bbb8b01f92404edbde78c5d52b1' },
  { path: 'assets/index.js', bytes: 1127668, sha256: 'd383ece5e5437794f40766462b14b4bc6ad105793c54fd771c650695984c9a24' },
]

it('parses the nested result.Contents listing as the primary structure without degradation', () => {
  const page = parseHostingListingPage(nestedPage)
  assert.equal(page?.source, 'result-contents')
  assert.equal(page?.degraded, false)
  assert.deepEqual(page?.files.map(file => file.key), [
    'mip-admin-console/404.html',
    'mip-admin-console/assets/',
    'mip-admin-console/assets/index.js',
  ])
  assert.deepEqual(page?.files.map(file => file.bytes), [465, 0, 1127668])
  assert.equal(page?.truncated, false)
})

it('falls back to the legacy flat data.files listing and flags degradation', () => {
  const page = parseHostingListingPage({ data: { action: 'findFiles', files: [{ Key: 'mip-admin-console/index.html', Size: '457226' }, { key: 'mip-admin-console/old.js', size: 12 }] } })
  assert.equal(page?.source, 'legacy-files')
  assert.equal(page?.degraded, true)
  assert.deepEqual(page?.files.map(file => [file.key, file.bytes]), [
    ['mip-admin-console/index.html', 457226],
    ['mip-admin-console/old.js', 12],
  ])
})

it('treats an ambiguous empty listing as legacy so an empty prefix still verifies loudly', () => {
  const page = parseHostingListingPage({ data: { action: 'findFiles', files: [] } })
  assert.equal(page?.source, 'legacy-files')
  assert.equal(page?.degraded, true)
  assert.equal(page?.files.length, 0)
})

it('rejects unrecognized listing shapes instead of silently verifying nothing', () => {
  assert.equal(parseHostingListingPage({ data: { action: 'findFiles' } }), null)
  assert.equal(parseHostingListingPage({ data: { result: { Contents: 'nope' } } }), null)
})

it('follows truncation markers across pages and stops when complete', () => {
  const requested: string[] = []
  const page = (_marker: string, keys: string[], truncated: boolean, nextMarker = '') => ({
    data: { result: { IsTruncated: truncated ? 'true' : 'false', NextMarker: nextMarker, Contents: keys.map(key => ({ Key: key, Size: '1' })) } },
  })
  const listing = collectHostingListing((marker) => {
    requested.push(marker)
    if (requested.length === 1) {
      return page(marker, ['mip-admin-console/a.js'], true, 'mip-admin-console/a.js')
    }
    return page(marker, ['mip-admin-console/b.js'], false)
  })
  assert.deepEqual(requested, ['', 'mip-admin-console/a.js'])
  assert.deepEqual(listing.files.map(file => file.key), ['mip-admin-console/a.js', 'mip-admin-console/b.js'])
  assert.equal(listing.raw.length, 2)
})

it('refuses pagination that does not advance', () => {
  assert.throws(() => collectHostingListing(() => ({ data: { result: { IsTruncated: true, Contents: [{ Key: 'mip-admin-console/a.js', Size: '1' }] } } })), /did not advance/)
  assert.throws(() => collectHostingListing(() => ({ data: { action: 'findFiles' } })), /listing shape/)
})

it('keeps directory marker keys out of file counts and prefix assertions', () => {
  const listing = parseHostingListingPage(nestedPage)!
  assert.deepEqual(hostingKeysOutsidePrefix(listing, 'mip-admin-console/'), [])
  assert.deepEqual(hostingKeysOutsidePrefix({ files: [{ key: 'other-prefix/leak.js', bytes: 3 }] }, 'mip-admin-console/'), ['other-prefix/leak.js'])
})

it('flags Cloudflare metadata and source maps but tolerates legacy static assets', () => {
  const listing = parseHostingListingPage({ data: { files: [
    { key: 'mip-admin-console/_headers', bytes: 10 },
    { key: 'mip-admin-console/assets/app.js.map', bytes: 10 },
    { key: 'mip-admin-console/card-templates/card-bg-a.webp', bytes: 10 },
    { key: 'mip-admin-console/assets/', bytes: 0 },
  ] } })!
  assert.deepEqual(hostingMetadataLeaks(listing, 'mip-admin-console/'), ['mip-admin-console/_headers', 'mip-admin-console/assets/app.js.map'])
})

it('compares manifest entries against the cloud listing by exact key and byte length', () => {
  const listing = parseHostingListingPage(nestedPage)!
  assert.deepEqual(manifestListingGaps(manifest, listing, 'mip-admin-console/'), [])
  const broken = parseHostingListingPage({ data: { result: { IsTruncated: 'false', Contents: [
    { Key: 'mip-admin-console/404.html', Size: '465' },
    { Key: 'mip-admin-console/assets/index.js', Size: '999' },
  ] } } })!
  assert.deepEqual(manifestListingGaps(manifest, broken, 'mip-admin-console/'), ['assets/index.js (listing bytes=999, local=1127668)'])
  const missing = parseHostingListingPage({ data: { files: [] } })!
  assert.equal(manifestListingGaps(manifest, missing, 'mip-admin-console/').length, 2)
})

it('detects cloud keys the directory download silently dropped', () => {
  const listing = parseHostingListingPage(nestedPage)!
  const complete = [
    { path: '404.html', bytes: 465, sha256: 'a' },
    { path: 'assets/index.js', bytes: 1127668, sha256: 'b' },
  ]
  assert.deepEqual(treeGapsAgainstListing(complete, listing, 'mip-admin-console/'), [])
  assert.deepEqual(
    treeGapsAgainstListing([{ path: '404.html', bytes: 465, sha256: 'a' }], listing, 'mip-admin-console/'),
    ['mip-admin-console/assets/index.js'],
  )
  assert.deepEqual(
    treeGapsAgainstListing([
      { path: '404.html', bytes: 465, sha256: 'a' },
      { path: 'assets/index.js', bytes: 1, sha256: 'b' },
    ], listing, 'mip-admin-console/'),
    ['mip-admin-console/assets/index.js'],
  )
})

it('hashes readback files with sha256', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'admin-static-readback-'))
  const file = path.join(directory, 'asset.js')
  writeFileSync(file, 'console.log("mip")\n')
  assert.equal(sha256File(file), createHash('sha256').update('console.log("mip")\n').digest('hex'))
})
