import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { publicOperationContract } = require(
  path.join(repositoryRoot, 'cloudfunctions/mip-admin-api/domain/public-operation-contract.js'),
)

export const ADMIN_OPERATION_CONTRACT_ARTIFACT = 'src/modules/mip-admin/generated/admin-operation-contract.json'

export function renderAdminOperationContract() {
  return `${JSON.stringify(publicOperationContract, null, 2)}\n`
}

export function assertAdminOperationContractArtifact(root = repositoryRoot) {
  const artifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_ARTIFACT)
  if (!fs.existsSync(artifactPath)
    || fs.readFileSync(artifactPath, 'utf8') !== renderAdminOperationContract()) {
    throw new Error('Admin operation contract artifact drifted; run node scripts/generate-admin-operation-contract.mjs --write')
  }
}

export function writeAdminOperationContractArtifact(root = repositoryRoot) {
  const artifactPath = path.join(root, ADMIN_OPERATION_CONTRACT_ARTIFACT)
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, renderAdminOperationContract(), 'utf8')
  return artifactPath
}
