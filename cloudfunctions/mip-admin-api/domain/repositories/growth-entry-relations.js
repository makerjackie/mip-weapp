'use strict'

/** Resolve object identities from stored relations, never reinterpret an event id as an object id. */
async function attachGrowthEntryRelations(database, appId, items) {
  if (!items.length) return items
  const ids = items.map(item => item.id)
  const rows = await database.query(`SELECT entry.id,
    COALESCE(checkin.event_id, registration.event_id) AS event_id,
    completion.id AS completion_id,
    COALESCE(referral.opportunity_id, cooperation.opportunity_id) AS opportunity_id,
    reversal.original_txn_no AS original_transaction_no
    FROM mip_growth_entries entry
    LEFT JOIN mip_outbox_events source_event ON source_event.app_id = entry.app_id
      AND source_event.id = entry.source_event_id AND source_event.event_type = entry.source_event_type
    LEFT JOIN mip_event_checkin_transitions checkin ON checkin.app_id = entry.app_id AND checkin.user_id = entry.user_id
      AND entry.source_event_type IN ('event.checked_in', 'event.checkin_revoked')
      AND checkin.id = IF(source_event.aggregate_type = 'EVENT_CHECKIN_TRANSITION', source_event.aggregate_id, entry.source_event_id)
    LEFT JOIN mip_event_registrations registration ON registration.app_id = entry.app_id AND registration.user_id = entry.user_id
      AND entry.source_event_type IN ('event.registered', 'event.checked_in')
      AND registration.id = IF(source_event.aggregate_type = 'EVENT_REGISTRATION', source_event.aggregate_id, entry.source_event_id)
    LEFT JOIN mip_task_completions completion ON completion.app_id = entry.app_id AND completion.user_id = entry.user_id
      AND entry.source_event_type = 'task.completed'
      AND completion.id = IF(source_event.aggregate_type = 'TASK_COMPLETION', source_event.aggregate_id, entry.source_event_id)
    LEFT JOIN mip_referral_intents referral ON referral.app_id = entry.app_id
      AND entry.source_event_type = 'referral.confirmed'
      AND referral.id = IF(source_event.aggregate_type = 'REFERRAL_INTENT', source_event.aggregate_id, entry.source_event_id)
    LEFT JOIN mip_opportunity_cooperations cooperation ON cooperation.app_id = entry.app_id
      AND entry.source_event_type = 'opportunity.cooperation.completed'
      AND cooperation.id = IF(source_event.aggregate_type = 'OPPORTUNITY_COOPERATION', source_event.aggregate_id, entry.source_event_id)
    LEFT JOIN mip_contribution_reversals reversal ON reversal.app_id = entry.app_id AND reversal.growth_entry_id = entry.id
      AND entry.source_event_type = 'CONTRIBUTION_REVERSAL'
    WHERE entry.app_id = ? AND entry.id IN (${ids.map(() => '?').join(',')})`, [appId, ...ids])
  const relations = new Map(rows.map(row => [row.id, row]))
  return items.map(item => {
    const row = relations.get(item.id)
    if (!row) return item
    const relatedResource = row.event_id ? { kind: 'EVENT', id: row.event_id }
      : row.completion_id ? { kind: 'TASK_COMPLETION', id: row.completion_id }
        : row.opportunity_id ? { kind: 'OPPORTUNITY', id: row.opportunity_id } : null
    return { ...item, ...(relatedResource ? { relatedResource } : {}), ...(row.original_transaction_no ? { originalTransactionNo: row.original_transaction_no } : {}) }
  })
}

module.exports = { attachGrowthEntryRelations }
