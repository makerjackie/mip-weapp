import type { ExportAdminGateway, ExportProgress, ExportSessionFence } from './export-download'
import type { PendingAdminExportStore } from './pending-export'
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
  gateway: ExportAdminGateway,
  cache: ExportsAdminCache,
  pendingStore?: PendingAdminExportStore,
  beginSession?: () => ExportSessionFence,
): MipExportsAdmin {
  const mutate = async <T>(work: () => Promise<T>) => {
    const result = await work()
    cache.invalidate('mip-admin:audit')
    return result
  }

  const workflowOptions = (onProgress?: (progress: ExportProgress) => void) => ({
    onProgress,
    pendingStore,
    sessionFence: beginSession?.(),
  })

  return {
    createAndOpen: (input, onProgress) => mutate(
      () => createAndOpenExport(gateway, input, workflowOptions(onProgress)),
    ),
    getPendingStatus: onProgress => getPendingAdminExportStatus(
      gateway,
      workflowOptions(onProgress),
    ),
    resumeAndOpen: async (onProgress) => {
      const result = await resumeAndOpenPendingAdminExport(
        gateway,
        workflowOptions(onProgress),
      )
      if (result) {
        cache.invalidate('mip-admin:audit')
      }
      return result
    },
    clearPending: ticketId => pendingStore?.clear(ticketId),
  }
}
