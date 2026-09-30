'use strict'
const { AdminError } = require('./validation')

// Event editing and the compatibility tag dialog share this transactional policy.
async function eventTagChange(tx, input) {
  const currentRows = await tx.query(`SELECT assignment.tag_id, tag.tag_key
    FROM mip_event_tag_assignments assignment INNER JOIN mip_event_tags tag
      ON tag.app_id = assignment.app_id AND tag.id = assignment.tag_id
    WHERE assignment.app_id = ? AND assignment.event_id = ? AND assignment.status = 'ACTIVE'
    ORDER BY assignment.tag_id FOR UPDATE`, [input.appId, input.eventId])
  const selectedRows = input.tagIds.length ? await tx.query(`SELECT id, tag_key, status FROM mip_event_tags
    WHERE app_id = ? AND id IN (${input.tagIds.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`, [input.appId, ...input.tagIds]) : []
  const currentIds = new Set(currentRows.map(row => String(row.tag_id)))
  if (selectedRows.length !== input.tagIds.length || selectedRows.some(row => row.status !== 'ACTIVE' && !currentIds.has(String(row.id)))) {
    throw new AdminError('CONFLICT', '活动标签已停用或不存在，请核对目录')
  }
  const selectedIds = new Set(selectedRows.map(row => String(row.id)))
  return { addedRows: selectedRows.filter(row => !currentIds.has(String(row.id))), removedRows: currentRows.filter(row => !selectedIds.has(String(row.tag_id))) }
}
async function applyEventTagChange(tx, input, change) {
  if (change.removedRows.length) await tx.query(`UPDATE mip_event_tag_assignments
    SET status = 'INACTIVE', removed_by_user_id = ?, removed_at = UTC_TIMESTAMP(3), version = version + 1
    WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE' AND tag_id IN (${change.removedRows.map(() => '?').join(', ')})`,
  [input.actorUserId, input.appId, input.eventId, ...change.removedRows.map(row => row.tag_id)])
  for (const row of change.addedRows) await tx.query(`INSERT INTO mip_event_tag_assignments (
    app_id, event_id, tag_id, status, version, assigned_by_user_id, removed_by_user_id, assigned_at, removed_at
    ) VALUES (?, ?, ?, 'ACTIVE', 1, ?, NULL, UTC_TIMESTAMP(3), NULL)
    ON DUPLICATE KEY UPDATE status = 'ACTIVE', version = version + 1, assigned_by_user_id = VALUES(assigned_by_user_id),
      removed_by_user_id = NULL, assigned_at = UTC_TIMESTAMP(3), removed_at = NULL`, [input.appId, input.eventId, row.id, input.actorUserId])
}
module.exports = { eventTagChange, applyEventTagChange }
