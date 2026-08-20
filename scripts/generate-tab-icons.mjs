#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { PNG } from 'pngjs'

const SIZE = 81

function parseHex(value) {
  const hex = value.replace('#', '')
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function paint(png, x, y, color, alpha = 255) {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
    return
  }
  const index = (png.width * py + px) << 2
  png.data[index] = color.r
  png.data[index + 1] = color.g
  png.data[index + 2] = color.b
  png.data[index + 3] = alpha
}

function stamp(png, x, y, color, radius = 2.2) {
  const bound = Math.ceil(radius)
  for (let ox = -bound; ox <= bound; ox += 1) {
    for (let oy = -bound; oy <= bound; oy += 1) {
      if ((ox * ox) + (oy * oy) <= radius * radius) {
        paint(png, x + ox, y + oy, color)
      }
    }
  }
}

function strokeLine(png, x0, y0, x1, y1, color, radius = 2.2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
  for (let i = 0; i <= steps; i += 1) {
    stamp(png, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, color, radius)
  }
}

function strokeRect(png, x, y, width, height, color, radius = 2.2) {
  strokeLine(png, x, y, x + width, y, color, radius)
  strokeLine(png, x + width, y, x + width, y + height, color, radius)
  strokeLine(png, x + width, y + height, x, y + height, color, radius)
  strokeLine(png, x, y + height, x, y, color, radius)
}

function strokeCircle(png, cx, cy, radius, color, brush = 2.2) {
  const steps = Math.max(24, Math.ceil(radius * 8))
  for (let i = 0; i <= steps; i += 1) {
    const angle = (Math.PI * 2 * i) / steps
    stamp(png, cx + (Math.cos(angle) * radius), cy + (Math.sin(angle) * radius), color, brush)
  }
}

const drawers = {
  home(png, color) {
    strokeLine(png, 18, 42, 40.5, 22, color)
    strokeLine(png, 40.5, 22, 63, 42, color)
    strokeRect(png, 24, 42, 33, 22, color)
    strokeRect(png, 36, 50, 9, 14, color)
  },
  app(png, color) {
    strokeRect(png, 20, 20, 16, 16, color)
    strokeRect(png, 45, 20, 16, 16, color)
    strokeRect(png, 20, 45, 16, 16, color)
    strokeRect(png, 45, 45, 16, 16, color)
  },
  setting(png, color) {
    strokeCircle(png, 40.5, 40.5, 11, color)
    strokeCircle(png, 40.5, 40.5, 4, color)
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i
      strokeLine(
        png,
        40.5 + (Math.cos(angle) * 16),
        40.5 + (Math.sin(angle) * 16),
        40.5 + (Math.cos(angle) * 24),
        40.5 + (Math.sin(angle) * 24),
        color,
      )
    }
  },
  usergroup(png, color) {
    strokeCircle(png, 30, 30, 8, color)
    strokeCircle(png, 51, 32, 7, color)
    strokeLine(png, 18, 56, 42, 56, color)
    strokeLine(png, 18, 56, 24, 42, color)
    strokeLine(png, 42, 56, 36, 42, color)
    strokeLine(png, 44, 56, 62, 56, color)
    strokeLine(png, 62, 56, 58, 44, color)
  },
  calendar(png, color) {
    strokeRect(png, 20, 24, 41, 36, color)
    strokeLine(png, 20, 34, 61, 34, color)
    strokeLine(png, 30, 18, 30, 28, color)
    strokeLine(png, 51, 18, 51, 28, color)
    stamp(png, 32, 44, color, 2.4)
    stamp(png, 41, 44, color, 2.4)
    stamp(png, 50, 44, color, 2.4)
  },
  user(png, color) {
    strokeCircle(png, 40.5, 30, 10, color)
    strokeLine(png, 22, 62, 59, 62, color)
    strokeLine(png, 22, 62, 28, 46, color)
    strokeLine(png, 59, 62, 53, 46, color)
  },
}

function writeIcon(outDir, name, color, drawer) {
  const png = new PNG({ width: SIZE, height: SIZE, colorType: 6 })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i + 3] = 0
  }
  drawer(png, color)
  fs.writeFileSync(path.join(outDir, `${name}.png`), PNG.sync.write(png))
}

const args = Object.fromEntries(process.argv.slice(2).flatMap((arg) => {
  const match = arg.match(/^--([^=]+)=(.*)$/)
  return match ? [[match[1], match[2]]] : []
}))

const outDir = path.resolve(args.out)
const brand = parseHex(args.brand)
const muted = parseHex(args.muted)
const names = String(args.icons || '').split(',').filter(Boolean)

fs.mkdirSync(outDir, { recursive: true })
for (const name of names) {
  const drawer = drawers[name]
  if (!drawer) {
    throw new Error(`Unknown tab icon: ${name}`)
  }
  writeIcon(outDir, name, muted, drawer)
  writeIcon(outDir, `${name}-active`, brand, drawer)
}

console.log(`Wrote ${names.length * 2} tab icons to ${outDir}`)
