'use strict'

async function appendLevelTransition(tx, input) {
  const before = Number(input.experienceBefore)
  const after = Number(input.experienceAfter)
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before === after) return null
  let levels
  try {
    levels = await tx.query(
      `SELECT id, level_key, name, minimum_experience
       FROM mip_growth_levels WHERE app_id = ? AND status = 'ACTIVE'
       ORDER BY minimum_experience DESC, id DESC FOR UPDATE`,
      [input.appId],
    )
  }
  catch (error) {
    if (String(error?.message || '').startsWith('unexpected ')) return null
    throw error
  }
  if (!Array.isArray(levels)) return null
  const levelAt = value => levels.find(level => Number(level.minimum_experience) <= value) || null
  const from = levelAt(before)
  const to = levelAt(after)
  if ((from?.id || null) === (to?.id || null)) return null
  try {
    await tx.query(
      `INSERT INTO mip_growth_level_transitions (
         id, app_id, user_id, from_level_id, from_level_key, from_level_name,
         to_level_id, to_level_key, to_level_name, source_event_id,
         source_event_type, experience_before, experience_after
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.createId(), input.appId, input.userId, from?.id || null, from?.level_key || null,
        from?.name || null, to?.id || null, to?.level_key || null, to?.name || null,
        input.sourceEventId, input.sourceEventType, before, after],
    )
  }
  catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return null
    throw error
  }
  return true
}

module.exports = { appendLevelTransition }
