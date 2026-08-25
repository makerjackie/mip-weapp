import type { ExportProgress } from './export-download'
import type { PendingAdminExportStore } from './pending-export'
import type { MipAdminGateway } from './types'
import {
  createAndOpenExport,
  getPendingAdminExportStatus,
  resumeAndOpenPendingAdminExport,
} from './export-download'

interface ExportsAdminCache {
  invalidate: (prefix?: string) => void
}

export interface MipExportsAdmin {
  createAndOpen: (
    input: Record<string, unknown>,
    onProgress?: (progress: ExportProgress) => void,
  ) => ReturnType<typeof createAndOpenExport>
  getPendingStatus: (
    onProgress?: (progress: ExportProgress) => void,
  ) => ReturnType<typeof getPendingAdminExportStatus>
  resumeAndOpen: (
    onProgress?: (progress: ExportProgress) => void,
  ) => ReturnType<typeof resumeAndOpenPendingAdminExport>
  clearPending: (ticketId?: string) => void
}

export function createMipExportsAdmin(
  gateway: MipAdminGateway,
  cache: ExportsAdminCache,
  pendingStore?: PendingAdminExportStore,
): MipExportsAdmin {
  const mutate = async <T>(work: () => Promise<T>) => {
    const result = await work()
    cache.invalidate('mip-admin:audit')
    return result
  }

  return {
    createAndOpen: (input, onProgress) => mutate(() => createAndOpenExport(gateway, input, {
      onProgress,
      pendingStore,
    })),
    getPendingStatus: onProgress => getPendingAdminExportStatus(gateway, {
      onProgress,
      pendingStore,
    }),
    resumeAndOpen: async (onProgress) => {
      const result = await resumeAndOpenPendingAdminExport(gateway, {
        onProgress,
        pendingStore,
      })
      if (result) {
        cache.invalidate('mip-admin:audit')
      }
      return result
    },
    clearPending: ticketId => pendingStore?.clear(ticketId),
  }
}
