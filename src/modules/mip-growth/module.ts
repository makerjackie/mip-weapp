import type { MipGrowthGateway } from './types'

export function createMipGrowthModule(gateway: MipGrowthGateway) {
  let snapshot: Awaited<ReturnType<MipGrowthGateway['getSnapshot']>> | undefined
  let pendingSnapshot: Promise<Awaited<ReturnType<MipGrowthGateway['getSnapshot']>>> | undefined
  let generation = 0
  let snapshotRequestSeq = 0

  return {
    peekSnapshot() {
      return snapshot
    },

    async getSnapshot(options: { force?: boolean } = {}) {
      if (!options.force && snapshot) {
        return snapshot
      }
      if (!options.force && pendingSnapshot) {
        return pendingSnapshot
      }
      const loadGeneration = generation
      const requestSeq = snapshotRequestSeq + 1
      snapshotRequestSeq = requestSeq
      const request = gateway.getSnapshot().then((result) => {
        if (loadGeneration === generation && requestSeq === snapshotRequestSeq) {
          snapshot = result
        }
        return result
      }).finally(() => {
        if (pendingSnapshot === request) {
          pendingSnapshot = undefined
        }
      })
      pendingSnapshot = request
      return request
    },

    listEntries(cursor?: string, limit = 20) {
      return gateway.listEntries(cursor, Math.min(30, Math.max(1, limit)))
    },

    listBadgeCollection() {
      return gateway.listBadgeCollection()
    },

    equipBadges(badgeIds: string[], expectedVersion: number) {
      return gateway.equipBadges([...new Set(badgeIds)].slice(0, 3), expectedVersion)
    },

    invalidate() {
      generation += 1
      snapshotRequestSeq += 1
      snapshot = undefined
      pendingSnapshot = undefined
    },
  }
}

export type MipGrowthModule = ReturnType<typeof createMipGrowthModule>
