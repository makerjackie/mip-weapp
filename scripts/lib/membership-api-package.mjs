/**
 * Membership-api packaging contract for shared activity-domain pure.cjs.
 *
 * CloudBase uploads only cloudfunctions/<name>/, so pure domain code must live
 * inside the function package. Local monorepo requires are false-green.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const FUNCTION_REL = 'cloudfunctions/membership-api'
const VENDOR_REL = `${FUNCTION_REL}/lib/vendor/activity-domain/pure.cjs`
const ADAPTER_REL = `${FUNCTION_REL}/lib/activity-domain-adapter.js`
const SOURCE_REL = 'src/shared/activity-domain/pure.cjs'

function defaultAssert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * @param {{
 *   caseRoot: string,
 *   repositoryRoot: string,
 *   assert?: (condition: unknown, message: string) => void,
 * }} options
 */
export function assertMembershipApiActivityDomainPackage(options) {
  const assert = options.assert || defaultAssert
  const { caseRoot, repositoryRoot } = options

  const vendorPath = path.join(caseRoot, VENDOR_REL)
  const sourcePath = path.join(repositoryRoot, SOURCE_REL)
  const adapterPath = path.join(caseRoot, ADAPTER_REL)

  assert(fs.existsSync(vendorPath), `membership-api must vendor ${VENDOR_REL}`)
  assert(fs.existsSync(sourcePath), `activity-domain source missing at ${SOURCE_REL}`)
  assert(fs.existsSync(adapterPath), 'activity-domain-adapter.js is missing')

  const vendorBuf = fs.readFileSync(vendorPath)
  const sourceBuf = fs.readFileSync(sourcePath)
  assert(
    vendorBuf.equals(sourceBuf),
    'membership-api lib/vendor/activity-domain/pure.cjs must be byte-identical to src/shared/activity-domain/pure.cjs',
  )

  const adapter = fs.readFileSync(adapterPath, 'utf8')
  // Comments may name the source of truth; only executable requires are forbidden to escape.
  const requireCalls = adapter.match(/require\(([^)]+)\)/g) || []
  assert(
    requireCalls.every((call) => {
      return !call.includes('packages/weapp-core')
        && !call.includes('@01mvp/weapp-core')
        && !call.includes('path.join')
        && !call.includes('../../../../../')
    }),
    'activity-domain-adapter must not resolve pure.cjs through monorepo, workspace, or package-escape paths',
  )
  assert(
    requireCalls.some(call => call.includes('./vendor/activity-domain/pure.cjs')),
    'activity-domain-adapter must require the in-package vendor pure.cjs',
  )

  assertIsolatedMembershipApiLoad(caseRoot, assert)
}

/**
 * Copy membership-api into a temp tree with no monorepo packages, stub npm deps,
 * and require the cold-start entry modules the way CloudBase would.
 *
 * @param {string} caseRoot
 * @param {(condition: unknown, message: string) => void} assert
 */
export function assertIsolatedMembershipApiLoad(caseRoot, assert = defaultAssert) {
  const functionRoot = path.join(caseRoot, FUNCTION_REL)
  assert(fs.existsSync(functionRoot), 'membership-api function root is missing')

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-api-isolated-'))
  try {
    fs.cpSync(functionRoot, staging, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src)
        // Deploy uploads the function tree without tests or local installs.
        return base !== 'tests' && base !== 'node_modules' && base !== '.tmp'
      },
    })

    writeNpmStub(path.join(staging, 'node_modules', 'wx-server-sdk'), {
      packageName: 'wx-server-sdk',
      index: `'use strict'
module.exports = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init() {},
  getWXContext() { return {} },
}
`,
    })
    writeMysql2Stub(path.join(staging, 'node_modules', 'mysql2'))
    // Image decoders must resolve inside the staged package (CloudBase install).
    writeNpmStub(path.join(staging, 'node_modules', 'pngjs'), {
      packageName: 'pngjs',
      index: `'use strict'
class PNG {
  constructor(options = {}) {
    this.width = options.width || 0
    this.height = options.height || 0
    this.data = Buffer.alloc((this.width * this.height) << 2, 0)
  }
}
PNG.sync = {
  read() { throw new Error('pngjs stub: decode not available in isolation smoke') },
  write() { return Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
}
module.exports = { PNG }
`,
    })
    writeNpmStub(path.join(staging, 'node_modules', 'jpeg-js'), {
      packageName: 'jpeg-js',
      index: `'use strict'
module.exports = {
  decode() { throw new Error('jpeg-js stub: decode not available in isolation smoke') },
  encode() { return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) } },
}
`,
    })

    // Guard: pure.cjs must resolve only under the staged function root.
    const script = `
'use strict'
const path = require('node:path')
const Module = require('node:module')
const root = process.cwd()
const original = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  const resolved = original.call(this, request, parent, isMain, options)
  const normalized = path.normalize(resolved)
  if (
    normalized.includes(\`\${path.sep}packages\${path.sep}weapp-core\${path.sep}\`)
    || normalized.includes(\`\${path.sep}node_modules\${path.sep}@01mvp\${path.sep}weapp-core\${path.sep}\`)
  ) {
    throw new Error('resolved monorepo/workspace weapp-core: ' + normalized)
  }
  if (normalized.endsWith(\`\${path.sep}activity-domain\${path.sep}pure.cjs\`)) {
    if (!normalized.startsWith(root + path.sep)) {
      throw new Error('pure.cjs resolved outside isolated package: ' + normalized)
    }
  }
  return resolved
}
require('./lib/workflows.js')
require('./index.js')
console.log('membership-api-isolated-load-ok')
`

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: staging,
      encoding: 'utf8',
      env: {
        ...process.env,
        // Do not inherit monorepo resolution paths.
        NODE_PATH: '',
      },
    })

    if (result.status !== 0) {
      throw new Error(
        `membership-api isolated load smoke failed (exit ${result.status}):\n${result.stdout || ''}\n${result.stderr || ''}`,
      )
    }
    assert(
      String(result.stdout).includes('membership-api-isolated-load-ok'),
      'membership-api isolated load smoke must print the success marker',
    )
  }
  finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * @param {string} dir
 * @param {{ packageName: string, index: string }} options
 */
function writeNpmStub(dir, options) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: options.packageName,
    version: '0.0.0-stub',
    main: 'index.js',
  }, null, 2)}\n`)
  fs.writeFileSync(path.join(dir, 'index.js'), options.index)
}

/** @param {string} dir */
function writeMysql2Stub(dir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'mysql2',
    version: '0.0.0-stub',
    main: 'index.js',
  }, null, 2)}\n`)
  fs.writeFileSync(path.join(dir, 'index.js'), `'use strict'\nmodule.exports = {}\n`)
  // mysql2/promise resolves as a sibling file under the package root.
  fs.writeFileSync(path.join(dir, 'promise.js'), `'use strict'
module.exports = {
  createPool() {
    return {
      async end() {},
      async getConnection() {
        return { release() {} }
      },
      async query() { return [[], []] },
      async execute() { return [[], []] },
    }
  },
}
`)
}
