import type { AdminRequestInput, AdminOperationAction } from '../domain/contracts'
import type { OperationValues } from './admin-operation-ui'
import type { AdminRowOperation } from './admin-row-operations'

/** Minimal row shape the batcher needs: row actions projected by the read page. */
export interface BatchableRow {
  rowActions?: readonly AdminRowOperation[]
}

export interface BatchExecutionSummary {
  /** Rows the operator selected. */
  total: number
  /** Rows whose operation ran and the server accepted. */
  succeeded: number
  /** Rows whose operation ran but the server rejected (version drift, permission, ...). */
  failed: number
  /** Rows that do not expose this action for their current server state. */
  skipped: number
}

export type BatchRequest = (action: AdminOperationAction, input: AdminRequestInput) => Promise<unknown>

function rowOperations(row: unknown): AdminRowOperation[] {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return []
  const actions = (row as BatchableRow).rowActions
  return Array.isArray(actions) ? [...actions] : []
}

/** Collects the per-row operation matching `action`, ignoring rows where it is not legal. */
export function collectBatchTargets(rows: readonly BatchableRow[], action: string): AdminRowOperation[] {
  return rows.flatMap((row) => {
    const operation = rowOperations(row).find(item => item.action === action)
    return operation ? [operation] : []
  })
}

/** Shared batch input overrides the per-row defaults (e.g. reason, decision, outcome). */
export function mergeBatchInput(operation: AdminRowOperation, values: OperationValues): AdminRequestInput {
  return { ...(operation.values || {}), ...values }
}

export function batchIdempotencyKey(action: string): string {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `web-batch-${action.split('.').at(-1) || 'operation'}-${suffix}`.slice(0, 128)
}

/**
 * Runs one action across the selected rows. Each row keeps its own optimistic
 * version and idempotency key, so a stale row fails alone instead of aborting
 * the batch. The server remains the authority on capability and state.
 */
export async function executeBatchAction(
  action: string,
  rows: readonly BatchableRow[],
  values: OperationValues,
  request: BatchRequest,
): Promise<BatchExecutionSummary> {
  const targets = collectBatchTargets(rows, action)
  let succeeded = 0
  let failed = 0
  for (const operation of targets) {
    try {
      await request(operation.action, {
        ...mergeBatchInput(operation, values),
        idempotencyKey: batchIdempotencyKey(action),
      })
      succeeded += 1
    }
    catch {
      failed += 1
    }
  }
  return { total: rows.length, succeeded, failed, skipped: rows.length - targets.length }
}

export function batchSummaryMessage(summary: BatchExecutionSummary): { type: 'success' | 'warning', text: string } {
  if (summary.failed || summary.skipped) {
    const parts = [`已处理 ${summary.succeeded} 条`]
    if (summary.failed) parts.push(`${summary.failed} 条失败`)
    if (summary.skipped) parts.push(`${summary.skipped} 条不适用当前状态`)
    return { type: 'warning', text: parts.join('，') }
  }
  return { type: 'success', text: `已批量处理 ${summary.succeeded} 条` }
}
