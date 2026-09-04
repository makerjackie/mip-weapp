import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT,
  assertAdminOperationContractArtifact,
  renderAdminOperationContractTypes,
} from '../scripts/lib/admin-operation-contract.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const removedRuntimeArtifact = 'src/modules/mip-admin/generated/admin-operation-contract.json'

function prepareGeneratorFixture(root: string) {
  const files = [
    'scripts/generate-admin-operation-contract.mjs',
    'scripts/lib/admin-operation-contract.mjs',
    'cloudfunctions/mip-admin-api/domain/public-operation-contract.js',
    'cloudfunctions/mip-admin-api/domain/operation-registry.js',
  ]
  for (const relativePath of files) {
    const targetPath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.copyFileSync(path.join(repositoryRoot, relativePath), targetPath)
  }
  fs.cpSync(
    path.join(repositoryRoot, 'cloudfunctions/mip-admin-api/domain/operations'),
    path.join(root, 'cloudfunctions/mip-admin-api/domain/operations'),
    { recursive: true },
  )
}

function runGenerator(root: string, mode: '--check' | '--write') {
  return execFileSync(
    process.execPath,
    [path.join(root, 'scripts/generate-admin-operation-contract.mjs'), mode],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

function expectGeneratorCheckToFail(root: string) {
  try {
    runGenerator(root, '--check')
    throw new Error('Expected generated contract check to fail')
  }
  catch (error) {
    expect(String((error as { stderr?: string }).stderr || error)).toContain('artifact drifted')
  }
}

describe('MIP admin operation contract generation', () => {
  const temporaryRoots: string[] = []

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { force: true, recursive: true })
    }
  })

  it('keeps only the TypeScript contract artifact byte-for-byte reproducible', () => {
    const typesArtifact = fs.readFileSync(
      path.resolve(repositoryRoot, ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT),
      'utf8',
    )

    expect(typesArtifact).toBe(renderAdminOperationContractTypes())
    expect(fs.existsSync(path.resolve(repositoryRoot, removedRuntimeArtifact))).toBe(false)
  })

  it('fails closed when the TypeScript artifact is missing or changed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-admin-contract-'))
    temporaryRoots.push(root)
    const typesArtifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT)

    expect(() => assertAdminOperationContractArtifact(root)).toThrow(/artifact drifted/)
    fs.mkdirSync(path.dirname(typesArtifactPath), { recursive: true })
    fs.writeFileSync(typesArtifactPath, '{}\n', 'utf8')
    expect(() => assertAdminOperationContractArtifact(root)).toThrow(/artifact drifted/)
    fs.writeFileSync(typesArtifactPath, renderAdminOperationContractTypes(), 'utf8')
    expect(() => assertAdminOperationContractArtifact(root)).not.toThrow()
  })

  it('writes and checks only the TypeScript artifact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-admin-contract-cli-'))
    temporaryRoots.push(root)
    prepareGeneratorFixture(root)

    expect(runGenerator(root, '--write')).toContain(ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT)
    expect(fs.readFileSync(path.join(root, ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT), 'utf8'))
      .toBe(renderAdminOperationContractTypes())
    expect(fs.existsSync(path.join(root, removedRuntimeArtifact))).toBe(false)
    expect(runGenerator(root, '--check')).toContain('artifact is current')

    fs.writeFileSync(path.join(root, ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT), '{}\n', 'utf8')
    expectGeneratorCheckToFail(root)
  })
})
