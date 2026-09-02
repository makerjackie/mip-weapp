import fs from 'node:fs'
import path from 'node:path'

const viewportProfiles = {
  'mobile-375': {
    height: null,
    width: { equals: 375 },
  },
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function readOption(args, name) {
  const prefix = `${name}=`
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === name) {
      const value = args[index + 1]
      invariant(value && !value.startsWith('--'), `${name} requires a value`)
      values.push(value)
      index += 1
    }
    else if (argument.startsWith(prefix)) {
      values.push(argument.slice(prefix.length))
    }
  }
  invariant(values.length <= 1, `${name} may only be provided once`)
  if (values.length === 0) {
    return undefined
  }
  invariant(values[0].trim(), `${name} requires a value`)
  return values[0].trim()
}

function isStrictChild(parent, child) {
  const relative = path.relative(parent, child)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function assertNoSymlinkSegments(root, target) {
  const relative = path.relative(root, target)
  invariant(!relative.startsWith('..') && !path.isAbsolute(relative), 'Runtime output directory must stay inside the repository')
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (!fs.existsSync(current)) {
      break
    }
    invariant(!fs.lstatSync(current).isSymbolicLink(), 'Runtime output directory cannot traverse a symbolic link')
  }
}

export function resolveRuntimeEvidenceOptions(root, args = []) {
  const defaultOutputDir = path.join(root, '.tmp', 'runtime')
  const evidenceRoot = path.join(root, '.tmp', 'runtime-evidence')
  const requestedOutputDir = readOption(args, '--output-dir')
  const viewportProfile = readOption(args, '--viewport')
  if (viewportProfile) {
    invariant(viewportProfiles[viewportProfile], `Unsupported runtime viewport profile: ${viewportProfile}`)
  }
  if (!requestedOutputDir) {
    return {
      evidenceRoot,
      isolated: false,
      outputDir: defaultOutputDir,
      outputPath: '.tmp/runtime',
      viewportProfile: viewportProfile || null,
    }
  }

  invariant(!requestedOutputDir.includes('\0'), 'Runtime output directory cannot contain a null byte')
  const outputDir = path.resolve(root, requestedOutputDir)
  invariant(
    isStrictChild(evidenceRoot, outputDir),
    'Custom runtime output directory must be a child of .tmp/runtime-evidence',
  )
  return {
    evidenceRoot,
    isolated: true,
    outputDir,
    outputPath: path.relative(root, outputDir),
    viewportProfile: viewportProfile || null,
  }
}

export function prepareRuntimeEvidenceDirectory(root, options) {
  assertNoSymlinkSegments(root, options.outputDir)
  if (options.isolated && fs.existsSync(options.outputDir)) {
    invariant(
      fs.readdirSync(options.outputDir).length === 0,
      'Custom runtime output directory must be new or empty to preserve earlier evidence',
    )
  }
  fs.mkdirSync(options.outputDir, { recursive: true })
  if (!options.isolated) {
    for (const entry of fs.readdirSync(options.outputDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        fs.rmSync(path.join(options.outputDir, entry.name))
      }
    }
  }
}

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function createPendingViewportEvidence(profileName) {
  const target = profileName ? viewportProfiles[profileName] : null
  return {
    automatedResize: false,
    measurement: 'miniProgram.systemInfo',
    mode: 'manual-required',
    observed: null,
    profile: profileName,
    status: 'not-observed',
    target,
  }
}

export function createObservedViewportEvidence(systemInfo, profileName) {
  const pending = createPendingViewportEvidence(profileName)
  const observed = {
    height: positiveNumber(systemInfo?.windowHeight),
    pixelRatio: positiveNumber(systemInfo?.pixelRatio),
    screenHeight: positiveNumber(systemInfo?.screenHeight),
    screenWidth: positiveNumber(systemInfo?.screenWidth),
    width: positiveNumber(systemInfo?.windowWidth),
  }
  invariant(observed.width && observed.height, 'DevTools systemInfo did not expose a measurable viewport')
  if (!pending.target) {
    return { ...pending, observed, status: 'observed-only' }
  }
  const widthMatches = pending.target.width.equals
    ? observed.width === pending.target.width.equals
    : observed.width >= pending.target.width.minimum
  return {
    ...pending,
    observed,
    status: widthMatches ? 'matched' : 'mismatched',
  }
}

export function assertViewportEvidence(evidence) {
  invariant(
    evidence.status !== 'mismatched',
    `Observed DevTools viewport ${evidence.observed.width}x${evidence.observed.height} does not match ${evidence.profile}`,
  )
}
