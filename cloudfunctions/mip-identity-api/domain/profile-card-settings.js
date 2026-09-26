'use strict'
const styles = ['PINK', 'BLUE', 'WHITE', 'YELLOW']
async function loadProfileCardSettings(database, appId, userId) {
  const [moderation, rows] = await Promise.all([
    database.one('SELECT status, reason FROM mip_profile_card_moderation WHERE app_id = ? AND user_id = ?', [appId, userId]),
    database.query("SELECT style_key, name, required_fields_json FROM mip_profile_card_templates WHERE app_id = ? AND status = 'ACTIVE' ORDER BY sort_order, style_key", [appId]),
  ])
  return { enabled: !moderation || moderation.status === 'ACTIVE', reason: moderation?.reason || '',
    templates: rows.filter(row => styles.includes(row.style_key)).map(row => ({ key: row.style_key, name: row.name,
      requiredFields: typeof row.required_fields_json === 'string' ? JSON.parse(row.required_fields_json) : row.required_fields_json })) }
}
module.exports = { loadProfileCardSettings }
