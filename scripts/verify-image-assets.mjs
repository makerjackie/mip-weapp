#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const MAX_TRACKED_IMAGE_BYTES = 500 * 1024
const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)$/i

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.git', '.weapp-vite', '.tmp'].includes(entry.name)) {
      return []
    }
    const child = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

for (const file of walk(root)) {
  if (!IMAGE_EXTENSION.test(file)) {
    continue
  }
  const relative = path.relative(root, file)
  const bytes = fs.statSync(file).size
  assert(bytes <= MAX_TRACKED_IMAGE_BYTES, `${relative} exceeds 500KiB (${bytes} bytes)`)
}

console.log('Image asset contract passed')
