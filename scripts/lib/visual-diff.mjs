import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

export function comparePngBuffers(baselineBuffer, currentBuffer, options = {}) {
  const baseline = PNG.sync.read(baselineBuffer)
  const current = PNG.sync.read(currentBuffer)

  if (baseline.width !== current.width || baseline.height !== current.height) {
    throw new Error(
      `Visual baseline dimensions changed: ${baseline.width}x${baseline.height} -> ${current.width}x${current.height}`,
    )
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height })
  const diffPixels = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: options.threshold ?? 0.1 },
  )
  const totalPixels = baseline.width * baseline.height

  return {
    width: baseline.width,
    height: baseline.height,
    diffPixels,
    diffRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    diffBuffer: PNG.sync.write(diff),
  }
}
