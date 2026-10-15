import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')

// ops.mjs resolves its repository root from its own location, so a copied
// scripts tree inside a temp sandbox keeps the gate tests hermetic — the
// real repo may legitimately carry a configured envs/<target>/.env.local.
function makeSandbox() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-ops-'))
  fs.cpSync(path.join(repoRoot, 'scripts'), path.join(sandbox, 'scripts'), { recursive: true })
  return sandbox
}

function runOps(args: string[], env: Record<string, string> = {}, sandbox = repoRoot) {
  return spawnSync('node', ['scripts/ops.mjs', ...args], {
    cwd: sandbox,
    env: { ...process.env, MIP_ENV_DIR: '', ...env },
    encoding: 'utf8',
  })
}

describe('ops orchestration gates', () => {
  it('requires an explicit --target', () => {
    const result = runOps([])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--target=test|production')
  })

  it('rejects an unknown target', () => {
    const result = runOps(['--target=staging'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--target=test|production')
  })

  it('refuses to run a target whose local configuration is absent', () => {
    const sandbox = makeSandbox()
    try {
      for (const target of ['test', 'production']) {
        const result = runOps([`--target=${target}`], {}, sandbox)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain(`Target ${target} is not configured`)
      }
    }
    finally {
      fs.rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('refuses a conflicting MIP_ENV_DIR in the surrounding environment', () => {
    const result = runOps(['--target=test'], { MIP_ENV_DIR: 'envs/prod' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('disagrees with --target')
  })
})
