import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMIN_OPERATION_CONTRACT_ARTIFACT,
  ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT,
  assertAdminOperationContractArtifact,
  renderAdminOperationContract,
  renderAdminOperationContractTypes,
} from '../scripts/lib/admin-operation-contract.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..')

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

function runGeneratorCheck(root: string) {
  return execFileSync(
    process.execPath,
    [path.join(root, 'scripts/generate-admin-operation-contract.mjs'), '--check'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

function expectGeneratorCheckToFail(root: string) {
  try {
    runGeneratorCheck(root)
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

  it('keeps the checked-in client artifact byte-for-byte reproducible', () => {
    const artifact = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', ADMIN_OPERATION_CONTRACT_ARTIFACT),
      'utf8',
    )
    expect(artifact).toBe(renderAdminOperationContract())
    const typesArtifact = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT),
      'utf8',
    )
    expect(typesArtifact).toBe(renderAdminOperationContractTypes())
  })

  it('fails closed when the generated artifact is missing or changed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-admin-contract-'))
    temporaryRoots.push(root)
    const artifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_ARTIFACT)
    const typesArtifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT)

    expect(() => assertAdminOperationContractArtifact(root)).toThrow(/artifact drifted/)
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
    fs.writeFileSync(artifactPath, '{}\n', 'utf8')
    expect(() => assertAdminOperationContractArtifact(root)).toThrow(/artifact drifted/)
    fs.writeFileSync(artifactPath, renderAdminOperationContract(), 'utf8')
    fs.mkdirSync(path.dirname(typesArtifactPath), { recursive: true })
    fs.writeFileSync(typesArtifactPath, '{}\n', 'utf8')
    expect(() => assertAdminOperationContractArtifact(root)).toThrow(/artifact drifted/)
  })

  it('makes the generator --check command fail for a missing or tampered artifact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-admin-contract-cli-'))
    temporaryRoots.push(root)
    prepareGeneratorFixture(root)
    const artifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_ARTIFACT)
    const typesArtifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_TYPES_ARTIFACT)

    fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
    fs.writeFileSync(artifactPath, renderAdminOperationContract(), 'utf8')
    fs.mkdirSync(path.dirname(typesArtifactPath), { recursive: true })
    fs.writeFileSync(typesArtifactPath, renderAdminOperationContractTypes(), 'utf8')
    expect(runGeneratorCheck(root)).toContain('artifact is current')

    fs.rmSync(artifactPath)
    expectGeneratorCheckToFail(root)

    fs.writeFileSync(artifactPath, '{}\n', 'utf8')
    expectGeneratorCheckToFail(root)
  })
})
