import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')

function runOps(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', ['scripts/ops.mjs', ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

// The worktree has no envs/*/.env.local committed (only env.example templates),
// so both targets must refuse to start locally without leaking env values.
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
    for (const target of ['test', 'production']) {
      const result = runOps([`--target=${target}`])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(`Target ${target} is not configured`)
    }
  })

  it('refuses a conflicting MIP_ENV_DIR in the surrounding environment', () => {
    const result = runOps(['--target=test'], { MIP_ENV_DIR: 'envs/prod' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('disagrees with --target')
  })
})
