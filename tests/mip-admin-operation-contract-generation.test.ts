import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMIN_OPERATION_CONTRACT_ARTIFACT,
  assertAdminOperationContractArtifact,
  renderAdminOperationContract,
} from '../scripts/lib/admin-operation-contract.mjs'

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
  })

  it('fails closed when the generated artifact is missing or changed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-admin-contract-'))
    temporaryRoots.push(root)
    const artifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_ARTIFACT)

    expect(() => assertAdminOperationContractArtifact(root)).toThrow(/artifact drifted/)
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
    fs.writeFileSync(artifactPath, '{}\n', 'utf8')
    expect(() => assertAdminOperationContractArtifact(root)).toThrow(/artifact drifted/)
  })
})
