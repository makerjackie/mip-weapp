import type { AdminCapability } from '../../../modules/mip-admin'

const selectionsByPage = new WeakMap<object, Set<AdminCapability>>()

function selectionFor(owner: object) {
  const current = selectionsByPage.get(owner)
  if (current) {
    return current
  }
  const created = new Set<AdminCapability>()
  selectionsByPage.set(owner, created)
  return created
}

export function replacePolicyCapabilitySelection(owner: object, capabilities: AdminCapability[]) {
  selectionsByPage.set(owner, new Set(capabilities))
}

export function hasSelectedPolicyCapability(owner: object, capability: AdminCapability) {
  return selectionFor(owner).has(capability)
}

export function togglePolicyCapabilitySelection(owner: object, capability: AdminCapability) {
  const selection = selectionFor(owner)
  if (selection.has(capability)) {
    selection.delete(capability)
  }
  else {
    selection.add(capability)
  }
}

export function selectedPolicyCapabilities(owner: object, allowedCapabilities: AdminCapability[]) {
  const selection = selectionFor(owner)
  return allowedCapabilities.filter(capability => selection.has(capability))
}

export function clearPolicyCapabilitySelection(owner: object) {
  selectionsByPage.delete(owner)
}
