import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

async function filesIn(folder) {
  const files = []
  for (const item of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name)
    files.push(...(item.isDirectory() ? await filesIn(file) : [file]))
  }
  return files
}

/** Build previews independently of immutable evidence. Original URLs stay byte-for-byte intact. */
export async function optimizeAcceptanceImages(output) {
  const files = await filesIn(output)
  const images = new Map()
  const stats = { images: 0, optimized: 0, originalBytes: 0, previewBytes: 0 }
  for (const file of files.filter(file => /\.(?:png|jpe?g|webp)$/i.test(file))) {
    const original = await fs.readFile(file)
    const image = sharp(original, { failOn: 'error' })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height || (metadata.pages || 1) > 1) {
      continue
    }
    const preview = await image.rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 86, effort: 5 }).toBuffer({ resolveWithObject: true })
    const route = `/${path.relative(output, file).split(path.sep).join('/')}`
    let src = route
    if (preview.data.length < original.length) {
      const hash = createHash('sha256').update(preview.data).digest('hex').slice(0, 24)
      src = `/assets/optimized-images/${hash}.webp`
      await fs.mkdir(path.join(output, 'assets/optimized-images'), { recursive: true })
      await fs.writeFile(path.join(output, src.slice(1)), preview.data)
      stats.optimized += 1
    }
    const width = src === route ? metadata.width : preview.info.width
    const height = src === route ? metadata.height : preview.info.height
    images.set(route, { src, width, height })
    stats.images += 1
    stats.originalBytes += original.length
    stats.previewBytes += src === route ? original.length : preview.data.length
  }
  for (const file of files.filter(file => file.endsWith('.html'))) {
    const html = await fs.readFile(file, 'utf8')
    const directory = path.posix.dirname(`/${path.relative(output, file).split(path.sep).join('/')}`)
    const updated = html.replace(/<img\b[^>]*>/gi, (tag) => {
      const source = tag.match(/\bsrc=(["'])(.*?)\1/i)
      if (!source || /^(?:[a-z]+:|\/\/|#)/i.test(source[2])) {
        return tag
      }
      const original = decodeURIComponent(new URL(source[2], `https://acceptance.invalid${directory}/`).pathname)
      const image = images.get(original)
      if (!image) {
        return tag
      }
      return tag.replace(source[0], `src="${image.src}"`)
        .replace(/\s(?:width|height)=["'][^"']*["']/gi, '')
        .replace(/\s*\/?>$/, ` width="${image.width}" height="${image.height}" decoding="async">`)
    })
    await fs.writeFile(file, updated)
  }
  await fs.writeFile(path.join(output, 'image-optimization.json'), `${JSON.stringify(stats, null, 2)}\n`)
  return stats
}
