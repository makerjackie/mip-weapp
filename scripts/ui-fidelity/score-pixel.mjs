#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
/**
 * Layer 3 — per-screen pixel scoring.
 *
 * Renders a route's WXML + WXSS (plus recursively inlined custom components) into a
 * standalone HTML document, screenshots it and the figma-restored reference screen
 * through the SAME headless Chromium, crops both to the content area, and scores the
 * pixel diff with pixelmatch. This is a Webview-proxy measurement, not WeChat
 * DevTools output — see PIXEL_RENDERING.md for what that does and does not prove.
 *
 *   node scripts/ui-fidelity/score-pixel.mjs [--only <screenKey>] [--out .ui-fidelity/pixel]
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { loadCooperationCardModel } from './lib/component-models.mjs'
import {
  loadIconColors,
  loadIconRegistry,
  mipIconHtml,
} from './lib/mip-icons.mjs'
import { repoRoot } from './lib/palette.mjs'
import {
  createComponentResolver,
  parseWxml,
  renderToHtml,
  scopeCss,
  toBrowserCss,
} from './lib/wxml.mjs'

const root = repoRoot(import.meta.dirname)
const SRC = path.join(root, 'src')
const REF_DIR = path.join(
  process.env.HOME ?? '',
  'project/ame-project/mip-minip-dev/figma-restored/pages',
)
const CHROME = path.join(
  process.env.HOME ?? '',
  'Library/Caches/ms-playwright/chromium_headless_shell-1187/chrome-mac/headless_shell',
)
const MANIFEST = path.join(root, 'config/ui-fidelity-screens.json')
const VIEWPORT = { width: 375, height: 812 }
const OUT_DIR = path.join(root, '.ui-fidelity/pixel')

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
}

/** Page WXSS plus every reachable component's WXSS, scoped to its instance. */
function buildDocument({ route, fixture }) {
  const appJson = readJson(path.join(SRC, 'app.json'))
  const base = path.join(SRC, route)
  const pageJson = readJson(`${base}.json`)
  const usingComponents = {
    ...(appJson.usingComponents ?? {}),
    ...(pageJson.usingComponents ?? {}),
  }

  const componentStyles = []
  const iconRegistry = loadIconRegistry(SRC)
  const iconColors = loadIconColors(SRC)
  const cardModel = loadCooperationCardModel(SRC)
  const resolveAssetFile = (assetPath) => {
    const exact = path.join(root, 'tests/fixtures/ui-fidelity', assetPath)
    if (fs.existsSync(exact)) {
      return exact
    }
    const webp = assetPath.endsWith('.png')
      ? path.join(root, 'tests/fixtures/ui-fidelity', `${assetPath.slice(0, -4)}.webp`)
      : exact
    return fs.existsSync(webp) ? webp : exact
  }
  const ctx = {
    instanceCount: 0,
    componentStyles,
    slotHtml: '',
    resolveComponent: null,
    // Repo-absolute asset paths (src/assets and package assets) resolve to files
    // on disk; the headless shell reads them over file:// when the document
    // itself is a local file.
    resolveAsset: src =>
      src?.startsWith('/pixel-assets/')
        ? resolveAssetFile(src.slice('/pixel-assets/'.length))
        : src?.startsWith('/packages/member/assets/')
          ? path.join(root, 'src', src.slice(1))
          : src?.startsWith('/packages/member/')
            ? path.join(root, 'src', src.slice(1))
            : src?.startsWith('/')
              ? path.join(SRC, src)
              : src,
    // Token colors resolve through the component's colors.ts mirror, exactly
    // like the mini-program component does (data-URI SVGs cannot see CSS vars).
    renderMipIcon: props => mipIconHtml(iconRegistry, props, iconColors),
    // Observer-built render data the proxy cannot compute from WXML alone.
    componentData: (tag, props) => {
      if (tag === 'mip-cooperation-card') {
        return {
          view: cardModel.cooperationRoleCardView({
            roleKey: String(props.roleKey ?? ''),
            name: props.name == null ? undefined : String(props.name),
            positioning:
              props.positioning == null ? undefined : String(props.positioning),
            targetSummary:
              props.targetSummary == null
                ? undefined
                : String(props.targetSummary),
          }),
        }
      }
      return undefined
    },
  }
  const resolver = createComponentResolver({
    srcDir: SRC,
    usingComponents,
    rootDir: root,
  })
  const styleQueue = []
  ctx.resolveComponent = (tag, extraUsingComponents) => {
    const entry = resolver(tag, extraUsingComponents)
    if (entry && !styleQueue.includes(entry)) {
      styleQueue.push(entry)
    }
    return entry
  }

  const nodes = parseWxml(fs.readFileSync(`${base}.wxml`, 'utf8'))
  const body = renderToHtml(nodes, { ...fixture }, ctx)
  // Nested component styles: resolve once, scope per instance id.
  const extraCss = new Map()
  for (const instance of componentStyles) {
    extraCss.set(instance.id, instance.css)
  }
  const pageCss = toBrowserCss(
    fs.existsSync(`${base}.wxss`)
      ? fs.readFileSync(`${base}.wxss`, 'utf8')
      : '',
  )
  const themeCss = fs
    .readFileSync(path.join(SRC, 'app.css'), 'utf8')
    .replace(/@import[^;]+;/g, '')
    .replace(/@source[^;]+;/g, '')

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script>
<style type="text/tailwindcss">${themeCss}</style>
<style>${pageCss}${[...extraCss.entries()].map(([id, css]) => scopeCss(css, id)).join('\n')}</style>
<style>html,body{margin:0;background:#080808;width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;overflow:hidden}
span{text-size-adjust:100%}img{display:block}</style>
</head><body>${body}</body></html>`
}

function screenshot(htmlFile, pngFile, height) {
  try {
    fs.rmSync(pngFile, { force: true })
  }
  catch {
    // Chrome overwrites the file; removal is only a guard against stale output.
  }
  const result = spawnSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--virtual-time-budget=8000',
      '--force-device-scale-factor=2',
      `--window-size=${VIEWPORT.width},${height}`,
      `--screenshot=${pngFile}`,
      `file://${htmlFile}`,
    ],
    { encoding: 'utf8' },
  )
  if (!fs.existsSync(pngFile)) {
    throw new Error(
      `screenshot failed for ${htmlFile}: ${result.stderr?.slice(0, 300)}`,
    )
  }
}

function crop(png, top, height) {
  const out = new PNG({ width: png.width, height })
  PNG.sync.write(png)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const src = ((y + top) * png.width + x) * 4
      const dst = (y * png.width + x) * 4
      out.data[dst] = png.data[src]
      out.data[dst + 1] = png.data[src + 1]
      out.data[dst + 2] = png.data[src + 2]
      out.data[dst + 3] = png.data[src + 3]
    }
  }
  return out
}

function scorePair(implPng, refPng, diffPath, threshold) {
  const width = Math.min(implPng.width, refPng.width)
  const height = Math.min(implPng.height, refPng.height)
  const a = new PNG({ width, height })
  const b = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4
      const sa = (y * implPng.width + x) * 4
      const sb = (y * refPng.width + x) * 4
      for (let c = 0; c < 4; c += 1) {
        a.data[dst + c] = implPng.data[sa + c]
        b.data[dst + c] = refPng.data[sb + c]
      }
    }
  }
  const diff = new PNG({ width, height })
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: threshold ?? 0.1,
    includeAA: false,
  })
  fs.writeFileSync(diffPath, PNG.sync.write(diff))
  return {
    width,
    height,
    diffPixels,
    totalPixels: width * height,
    score: Number(
      (((width * height - diffPixels) / (width * height)) * 100).toFixed(2),
    ),
  }
}

export function runPixelScore({ only, outDir = OUT_DIR, quiet = false } = {}) {
  if (!fs.existsSync(CHROME)) {
    throw new Error(`headless chromium missing at ${CHROME}`)
  }
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(
      `no screen manifest at ${path.relative(root, MANIFEST)} — add entries to score screens`,
    )
  }
  fs.mkdirSync(outDir, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const results = []

  for (const entry of manifest.screens) {
    if (only && entry.key !== only) {
      continue
    }
    const key = entry.key
    try {
      const html = buildDocument({
        route: entry.route,
        fixture: entry.fixture ?? {},
      })
      const htmlPath = path.join(outDir, `${key}.html`)
      fs.writeFileSync(htmlPath, html)
      const cropTop = entry.crop?.topPx ?? 0
      const cropBottom = entry.crop?.bottomPx ?? 0
      const shotHeight = VIEWPORT.height
      screenshot(htmlPath, path.join(outDir, `${key}.impl.png`), shotHeight)
      const refFile = path.join(REF_DIR, entry.reference)
      if (!fs.existsSync(refFile)) {
        throw new Error(`reference missing: ${refFile}`)
      }
      screenshot(refFile, path.join(outDir, `${key}.ref.png`), shotHeight)

      const scale = 2
      const impl = PNG.sync.read(
        fs.readFileSync(path.join(outDir, `${key}.impl.png`)),
      )
      const ref = PNG.sync.read(
        fs.readFileSync(path.join(outDir, `${key}.ref.png`)),
      )
      const refCrop = crop(
        ref,
        cropTop * scale,
        (shotHeight - cropTop - cropBottom) * scale,
      )
      const implCrop = crop(impl, 0, refCrop.height)
      const measured = scorePair(
        implCrop,
        refCrop,
        path.join(outDir, `${key}.diff.png`),
        entry.threshold,
      )
      results.push({
        key,
        route: entry.route,
        reference: entry.reference,
        ...measured,
        pass: measured.score >= (manifest.threshold ?? 92),
        crop: {
          topPx: cropTop,
          bottomPx: cropBottom,
          comparedHeightPx: refCrop.height / scale,
        },
      })
      if (!quiet) {
        console.log(
          `  ${String(measured.score).padStart(6)}%  ${key}  (${measured.width}x${measured.height}, diff ${measured.diffPixels})`,
        )
      }
    }
    catch (error) {
      results.push({
        key,
        route: entry.route,
        error: String(error.message).slice(0, 300),
        score: 0,
        pass: false,
      })
      if (!quiet) {
        console.log(
          `   ERROR   ${key}  ${String(error.stack ?? error.message)
            .split('\n')
            .slice(0, 4)
            .join(' | ')
            .slice(0, 300)}`,
        )
      }
    }
  }

  const scored = results.filter(r => !r.error)
  const report = {
    layer: 'pixel',
    renderer: 'headless-chromium-webview-proxy',
    caveat:
      'Rendered from WXML/WXSS through a browser proxy with fixture data; not WeChat DevTools output.',
    threshold: manifest.threshold ?? 92,
    screensInManifest: manifest.screens.length,
    totalRoutes: (readJson(path.join(SRC, 'app.json')).pages ?? []).length,
    scored: scored.length,
    passing: scored.filter(r => r.pass).length,
    meanScore: scored.length
      ? Number(
          (scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(2),
        )
      : null,
    results,
  }
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  if (!quiet) {
    console.log(
      `Layer 3 pixel: ${report.passing}/${report.scored} scored screens >= ${report.threshold}% (mean ${report.meanScore}%); ${report.screensInManifest - report.scored} unscored`,
    )
    console.log(
      `  report: ${path.relative(root, path.join(outDir, 'report.json'))}`,
    )
  }
  return report
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const args = process.argv.slice(2)
  const onlyIdx = args.indexOf('--only')
  const report = runPixelScore({
    only: onlyIdx >= 0 ? args[onlyIdx + 1] : null,
  })
  process.exitCode
    = report.scored > 0 && report.passing === report.scored ? 0 : 1
}
