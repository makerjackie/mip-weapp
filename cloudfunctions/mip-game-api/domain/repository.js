'use strict'

const { randomUUID } = require('node:crypto')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const {
  boundedText,
  expectedVersion,
  normalizeMatch,
  normalizeMembers,
  normalizeSeason,
  normalizeTeam,
  optionalId,
  rankingType,
  requiredId,
} = require('./validation')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const GAME_CAPABILITY = 'game.manage'
const GAME_ADMIN_ROLES = new Set(['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'])

function createGameRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function getAdminSession(caller) {
    return { capability: GAME_CAPABILITY, roleKey: await assertGameAdmin(database, caller) }
  }

  async function currentSeason(db, appId, seasonId) {
    if (seasonId) {
      return db.one(
        `SELECT * FROM mip_game_seasons
         WHERE app_id = ? AND id = ? AND status IN ('ACTIVE', 'CLOSED')`,
        [appId, requiredId(seasonId)],
      )
    }
    return db.one(
      `SELECT * FROM mip_game_seasons
       WHERE app_id = ? AND status = 'ACTIVE'
       ORDER BY starts_at DESC, id DESC LIMIT 1`,
      [appId],
    )
  }

  async function getOverview(caller, event = {}) {
    const season = await currentSeason(database, caller.appId, event.seasonId)
    if (!season) return { season: null, team: null, matches: [], standings: [] }
    const team = await database.one(
      `SELECT team.*, branch.name AS branch_name,
              (SELECT COUNT(*) FROM mip_game_team_memberships member
               WHERE member.app_id = team.app_id AND member.season_id = team.season_id
                 AND member.team_id = team.id AND member.status = 'ACTIVE') AS member_count
       FROM mip_game_team_memberships own
       INNER JOIN mip_game_teams team
         ON team.app_id = own.app_id AND team.season_id = own.season_id AND team.id = own.team_id
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = team.app_id AND branch.id = team.branch_id
       WHERE own.app_id = ? AND own.season_id = ? AND own.user_id = ? AND own.status = 'ACTIVE'`,
      [caller.appId, season.id, caller.userId],
    )
    const matches = await database.query(
      `SELECT game.*, team_a.name AS team_a_name, team_b.name AS team_b_name
       FROM mip_game_weekly_matches game
       INNER JOIN mip_game_teams team_a ON team_a.app_id = game.app_id AND team_a.id = game.team_a_id
       INNER JOIN mip_game_teams team_b ON team_b.app_id = game.app_id AND team_b.id = game.team_b_id
       WHERE game.app_id = ? AND game.season_id = ?
       ORDER BY game.week_start DESC, game.id DESC LIMIT 6`,
      [caller.appId, season.id],
    )
    const defaultType = season.period_kind === 'YEAR' ? 'TEAM_YEAR' : 'TEAM_HALF_YEAR'
    const ranking = await rankingPage(caller, { seasonId: season.id, rankingType: defaultType, limit: 10 })
    const ownTeamScore = team
      ? await teamExperience(database, caller.appId, season.id, team.id, season.starts_at, season.ends_at)
      : 0
    return {
      season: seasonDto(season),
      team: team ? teamDto({ ...team, score: ownTeamScore }, season) : null,
      matches: matches.map(matchDto),
      standings: ranking.items,
      rankingGeneratedAt: ranking.generatedAt,
    }
  }

  async function getRules(caller, event = {}) {
    const season = await currentSeason(database, caller.appId, event.seasonId)
    if (!season) throw new Error('NOT_FOUND')
    return { seasonId: season.id, seasonName: season.name, rulesText: season.rules_text, rules: parseRules(season.rules_json) }
  }

  async function getTeam(caller, event = {}) {
    const teamId = requiredId(event.teamId)
    const row = await database.one(
      `SELECT team.*, season.name AS season_name, season.rules_json, season.status AS season_status,
              season.starts_at, season.ends_at,
              branch.name AS branch_name
       FROM mip_game_teams team
       INNER JOIN mip_game_seasons season
         ON season.app_id = team.app_id AND season.id = team.season_id
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = team.app_id AND branch.id = team.branch_id
       WHERE team.app_id = ? AND team.id = ? AND season.status IN ('ACTIVE', 'CLOSED')`,
      [caller.appId, teamId],
    )
    if (!row) throw new Error('NOT_FOUND')
    const members = await database.query(
      `SELECT member.user_id, member.role, member.status, member.joined_at, member.left_at, profile.nickname,
              asset.cloud_file_id AS avatar_url
       FROM mip_game_team_memberships member
       INNER JOIN mip_users user
         ON user.app_id = member.app_id AND user.id = member.user_id AND user.status = 'ACTIVE'
       LEFT JOIN mip_profiles profile
         ON profile.app_id = member.app_id AND profile.user_id = member.user_id
       LEFT JOIN mip_media_assets asset
         ON asset.app_id = profile.app_id AND asset.id = profile.avatar_asset_id AND asset.status = 'READY'
       WHERE member.app_id = ? AND member.season_id = ? AND member.team_id = ?
       ORDER BY member.status = 'ACTIVE' DESC, member.role = 'CAPTAIN' DESC, member.joined_at, member.user_id`,
      [caller.appId, row.season_id, row.id],
    )
    const activeMembers = members.filter(member => member.status === 'ACTIVE')
    const formerMembers = members.filter(member => member.status === 'LEFT')
    const score = await teamExperience(database, caller.appId, row.season_id, row.id, row.starts_at, row.ends_at)
    const level = headquartersLevel(score, parseRules(row.rules_json))
    return {
      ...teamDto({ ...row, member_count: activeMembers.length }, { rules_json: row.rules_json }),
      seasonName: row.season_name,
      score,
      headquartersLevel: level,
      members: activeMembers.map(member => teamMemberDto(caller, member)),
      formerMembers: formerMembers.map(member => teamMemberDto(caller, member)),
    }
  }

  function teamMemberDto(caller, member) {
    return {
        memberRef: createProfileRef({ appId: caller.appId, userId: member.user_id }, caller.profileRefSecret),
        nickname: member.nickname || '未设置昵称',
        avatarUrl: member.avatar_url || '',
        role: member.role,
        status: member.status,
        joinedAt: iso(member.joined_at),
        leftAt: iso(member.left_at),
    }
  }

  async function listHistory(caller, event = {}) {
    const season = await currentSeason(database, caller.appId, event.seasonId)
    if (!season) return { season: null, items: [] }
    const rows = await database.query(
      `SELECT game.*, team_a.name AS team_a_name, team_b.name AS team_b_name
       FROM mip_game_weekly_matches game
       INNER JOIN mip_game_teams team_a ON team_a.app_id = game.app_id AND team_a.id = game.team_a_id
       INNER JOIN mip_game_teams team_b ON team_b.app_id = game.app_id AND team_b.id = game.team_b_id
       WHERE game.app_id = ? AND game.season_id = ? AND game.status = 'FINALIZED'
       ORDER BY game.week_start DESC, game.id DESC LIMIT 50`,
      [caller.appId, season.id],
    )
    return { season: seasonDto(season), items: rows.map(matchDto) }
  }

  function listRankings(caller, event = {}) {
    return rankingPage(caller, event, false)
  }

  async function listAdminRankings(caller, event = {}) {
    await assertGameAdmin(database, caller)
    return rankingPage(caller, event, true)
  }

  async function rankingPage(caller, event = {}, includeDraft = false) {
    const seasonId = requiredId(event.seasonId)
    const type = rankingType(event.rankingType)
    const branchId = optionalId(event.branchId)
    const limit = Math.min(Math.max(Number(event.limit) || 50, 1), 100)
    const season = await database.one(
      `SELECT id FROM mip_game_seasons
       WHERE app_id = ? AND id = ? ${includeDraft ? '' : "AND status IN ('ACTIVE', 'CLOSED')"}`,
      [caller.appId, seasonId],
    )
    if (!season) throw new Error('NOT_FOUND')
    const snapshot = await database.one(
      `SELECT * FROM mip_game_ranking_snapshots
       WHERE app_id = ? AND season_id = ? AND ranking_type = ? AND status = 'CURRENT'
       ORDER BY generated_at DESC, id DESC LIMIT 1`,
      [caller.appId, seasonId, type],
    )
    const branches = await database.query(
      `SELECT id, name, city_name FROM mip_city_branches
       WHERE app_id = ? AND status = 'ACTIVE' ORDER BY city_name, name, id`,
      [caller.appId],
    )
    if (!snapshot) return { rankingType: type, generatedAt: '', branches: branches.map(branchDto), items: [] }
    const params = [caller.appId, snapshot.id]
    const branchSql = branchId ? 'AND entry.branch_id = ?' : ''
    if (branchId) params.push(branchId)
    params.push(limit)
    const rows = await database.query(
      `SELECT entry.*, branch.name AS branch_name
       FROM mip_game_ranking_entries entry
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = entry.app_id AND branch.id = entry.branch_id
       WHERE entry.app_id = ? AND entry.snapshot_id = ? ${branchSql}
       ORDER BY entry.rank_no LIMIT ?`,
      params,
    )
    return {
      rankingType: type,
      generatedAt: iso(snapshot.generated_at),
      periodStart: iso(snapshot.period_start),
      periodEnd: iso(snapshot.period_end),
      branches: branches.map(branchDto),
      items: rows.map(rankingEntryDto),
    }
  }

  async function listSeasons(caller) {
    await assertGameAdmin(database, caller)
    const rows = await database.query(
      `SELECT * FROM mip_game_seasons WHERE app_id = ? ORDER BY starts_at DESC, id DESC`,
      [caller.appId],
    )
    return { items: rows.map(seasonDto) }
  }

  async function saveSeason(caller, event = {}) {
    const draft = normalizeSeason(event.season)
    const seasonId = event.seasonId ? requiredId(event.seasonId) : createId()
    const version = event.seasonId ? expectedVersion(event.expectedVersion) : null
    return database.transaction(async (tx) => {
      const roleKey = await assertGameAdmin(tx, caller, true)
      if (!event.seasonId) {
        await tx.query(
          `INSERT INTO mip_game_seasons (
             id, app_id, season_key, name, summary, rules_text, rules_json, period_kind,
             starts_at, ends_at, created_by_user_id, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [seasonId, caller.appId, draft.seasonKey, draft.name, draft.summary, draft.rulesText,
            JSON.stringify(draft.rules), draft.periodKind, draft.startsAt, draft.endsAt, caller.userId, caller.userId],
        )
        await writeAudit(tx, caller, roleKey, 'game.season.created', 'GAME_SEASON', seasonId)
      }
      else {
        const current = await tx.one(
          `SELECT status, version FROM mip_game_seasons WHERE app_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, seasonId],
        )
        if (!current) throw new Error('NOT_FOUND')
        if (Number(current.version) !== version) throw new Error('CONFLICT')
        if (current.status === 'CLOSED') throw new Error('INVALID_STATE')
        const result = await tx.query(
          `UPDATE mip_game_seasons SET season_key = ?, name = ?, summary = ?, rules_text = ?,
             rules_json = ?, period_kind = ?, starts_at = ?, ends_at = ?, updated_by_user_id = ?,
             version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [draft.seasonKey, draft.name, draft.summary, draft.rulesText, JSON.stringify(draft.rules),
            draft.periodKind, draft.startsAt, draft.endsAt, caller.userId, caller.appId, seasonId, version],
        )
        if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
        await writeAudit(tx, caller, roleKey, 'game.season.updated', 'GAME_SEASON', seasonId)
      }
      return seasonDto(await tx.one('SELECT * FROM mip_game_seasons WHERE app_id = ? AND id = ?', [caller.appId, seasonId]))
    })
  }

  async function changeSeasonStatus(caller, event = {}) {
    const seasonId = requiredId(event.seasonId)
    const version = expectedVersion(event.expectedVersion)
    const target = boundedText(event.status, 16, true).toUpperCase()
    if (!['ACTIVE', 'CLOSED'].includes(target)) throw new Error('VALIDATION_FAILED')
    return database.transaction(async (tx) => {
      const roleKey = await assertGameAdmin(tx, caller, true)
      const current = await tx.one(
        `SELECT status, version, starts_at, ends_at FROM mip_game_seasons
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, seasonId],
      )
      if (!current) throw new Error('NOT_FOUND')
      if (Number(current.version) !== version) throw new Error('CONFLICT')
      const allowed = (current.status === 'DRAFT' && target === 'ACTIVE')
        || (current.status === 'ACTIVE' && target === 'CLOSED')
      if (!allowed) throw new Error('INVALID_STATE')
      if (target === 'ACTIVE') {
        const overlap = await tx.one(
          `SELECT id FROM mip_game_seasons
           WHERE app_id = ? AND id <> ? AND status = 'ACTIVE'
             AND starts_at < ? AND ends_at > ? LIMIT 1 FOR UPDATE`,
          [caller.appId, seasonId, current.ends_at, current.starts_at],
        )
        if (overlap) throw new Error('CONFLICT')
      }
      const result = await tx.query(
        `UPDATE mip_game_seasons SET status = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [target, caller.userId, caller.appId, seasonId, version],
      )
      if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
      await writeAudit(tx, caller, roleKey, `game.season.${target.toLowerCase()}`, 'GAME_SEASON', seasonId)
      return seasonDto(await tx.one('SELECT * FROM mip_game_seasons WHERE app_id = ? AND id = ?', [caller.appId, seasonId]))
    })
  }

  async function listTeams(caller, event = {}) {
    await assertGameAdmin(database, caller)
    const seasonId = requiredId(event.seasonId)
    const rows = await database.query(
      `SELECT team.*, branch.name AS branch_name,
              (SELECT COUNT(*) FROM mip_game_team_memberships member
               WHERE member.app_id = team.app_id AND member.season_id = team.season_id
                 AND member.team_id = team.id AND member.status = 'ACTIVE') AS member_count
       FROM mip_game_teams team
       LEFT JOIN mip_city_branches branch ON branch.app_id = team.app_id AND branch.id = team.branch_id
       WHERE team.app_id = ? AND team.season_id = ? ORDER BY team.status, team.name, team.id`,
      [caller.appId, seasonId],
    )
    return { items: rows.map(row => teamDto(row)) }
  }

  async function saveTeam(caller, event = {}) {
    const draft = normalizeTeam(event.team)
    const teamId = event.teamId ? requiredId(event.teamId) : createId()
    const version = event.teamId ? expectedVersion(event.expectedVersion) : null
    return database.transaction(async (tx) => {
      const roleKey = await assertGameAdmin(tx, caller, true)
      const season = await tx.one(
        `SELECT status FROM mip_game_seasons WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, draft.seasonId],
      )
      if (!season) throw new Error('NOT_FOUND')
      if (season.status === 'CLOSED') throw new Error('INVALID_STATE')
      if (!event.teamId) {
        await tx.query(
          `INSERT INTO mip_game_teams (
             id, app_id, season_id, branch_id, name, summary, created_by_user_id, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [teamId, caller.appId, draft.seasonId, draft.branchId, draft.name, draft.summary, caller.userId, caller.userId],
        )
        await writeAudit(tx, caller, roleKey, 'game.team.created', 'GAME_TEAM', teamId)
      }
      else {
        const current = await tx.one(
          `SELECT season_id, version FROM mip_game_teams WHERE app_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, teamId],
        )
        if (!current) throw new Error('NOT_FOUND')
        if (current.season_id !== draft.seasonId || Number(current.version) !== version) throw new Error('CONFLICT')
        const result = await tx.query(
          `UPDATE mip_game_teams SET branch_id = ?, name = ?, summary = ?, updated_by_user_id = ?,
             version = version + 1 WHERE app_id = ? AND id = ? AND version = ?`,
          [draft.branchId, draft.name, draft.summary, caller.userId, caller.appId, teamId, version],
        )
        if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
        await writeAudit(tx, caller, roleKey, 'game.team.updated', 'GAME_TEAM', teamId)
      }
      return teamDto(await tx.one('SELECT * FROM mip_game_teams WHERE app_id = ? AND id = ?', [caller.appId, teamId]))
    })
  }

  async function listAssignableMembers(caller, event = {}) {
    await assertGameAdmin(database, caller)
    const seasonId = requiredId(event.seasonId)
    const query = boundedText(event.query, 80)
    const params = [seasonId, caller.appId]
    let querySql = ''
    if (query) {
      querySql = 'AND profile.nickname LIKE ?'
      params.push(`%${query}%`)
    }
    const rows = await database.query(
      `SELECT user.id, profile.nickname, branch.name AS branch_name,
              membership.team_id, membership.role, team.name AS team_name
       FROM mip_users user
       INNER JOIN mip_profiles profile ON profile.app_id = user.app_id AND profile.user_id = user.id
       LEFT JOIN mip_city_branches branch ON branch.app_id = user.app_id AND branch.id = user.primary_branch_id
       LEFT JOIN mip_game_team_memberships membership
         ON membership.app_id = user.app_id AND membership.season_id = ?
        AND membership.user_id = user.id AND membership.status = 'ACTIVE'
       LEFT JOIN mip_game_teams team ON team.app_id = membership.app_id AND team.id = membership.team_id
       WHERE user.app_id = ? AND user.status = 'ACTIVE'
         AND EXISTS (
           SELECT 1 FROM mip_membership_entitlements entitlement
           WHERE entitlement.app_id = user.app_id AND entitlement.user_id = user.id
             AND entitlement.status = 'ACTIVE' AND entitlement.starts_at <= UTC_TIMESTAMP(3)
             AND entitlement.ends_at > UTC_TIMESTAMP(3)
         ) ${querySql}
       ORDER BY profile.nickname, user.id LIMIT 100`,
      params,
    )
    return { items: rows.map(row => ({
      memberRef: createProfileRef({ appId: caller.appId, userId: row.id }, caller.profileRefSecret),
      nickname: row.nickname,
      branchName: row.branch_name || '',
      teamId: row.team_id || '',
      teamName: row.team_name || '',
      role: row.role || '',
    })) }
  }

  async function replaceTeamMembers(caller, event = {}) {
    const seasonId = requiredId(event.seasonId)
    const teamId = requiredId(event.teamId)
    const version = expectedVersion(event.expectedVersion)
    const members = normalizeMembers(event.members)
    const memberIds = members.map(item => ({
      userId: readProfileRef(item.memberRef, caller.appId, caller.profileRefSecret),
      role: item.role,
    }))
    if (memberIds.filter(item => item.role === 'CAPTAIN').length > 1) throw new Error('VALIDATION_FAILED')
    return database.transaction(async (tx) => {
      const roleKey = await assertGameAdmin(tx, caller, true)
      const team = await tx.one(
        `SELECT version FROM mip_game_teams WHERE app_id = ? AND season_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, seasonId, teamId],
      )
      if (!team) throw new Error('NOT_FOUND')
      if (Number(team.version) !== version) throw new Error('CONFLICT')
      for (const member of memberIds) {
        const user = await tx.one(
          `SELECT user.status,
                  EXISTS (
                    SELECT 1 FROM mip_membership_entitlements entitlement
                    WHERE entitlement.app_id = user.app_id AND entitlement.user_id = user.id
                      AND entitlement.status = 'ACTIVE' AND entitlement.starts_at <= UTC_TIMESTAMP(3)
                      AND entitlement.ends_at > UTC_TIMESTAMP(3)
                  ) AS is_player
           FROM mip_users user WHERE user.app_id = ? AND user.id = ? FOR UPDATE`,
          [caller.appId, member.userId],
        )
        if (!user || user.status !== 'ACTIVE' || !Number(user.is_player)) throw new Error('MEMBER_NOT_FOUND')
      }
      const selectedIds = new Set(memberIds.map(member => member.userId))
      const currentMembers = await tx.query(
        `SELECT id, user_id FROM mip_game_team_memberships
         WHERE app_id = ? AND season_id = ? AND team_id = ? AND status = 'ACTIVE' FOR UPDATE`,
        [caller.appId, seasonId, teamId],
      )
      for (const current of currentMembers) {
        if (!selectedIds.has(current.user_id)) {
          await tx.query(
            `UPDATE mip_game_team_memberships SET status = 'LEFT', left_at = CURRENT_TIMESTAMP(3),
               version = version + 1 WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
            [caller.appId, current.id],
          )
        }
      }
      for (const member of memberIds) {
        const existing = await tx.one(
          `SELECT id, team_id, role FROM mip_game_team_memberships
           WHERE app_id = ? AND season_id = ? AND user_id = ? AND status = 'ACTIVE' FOR UPDATE`,
          [caller.appId, seasonId, member.userId],
        )
        if (existing?.team_id === teamId) {
          if (existing.role !== member.role) {
            await tx.query(
              `UPDATE mip_game_team_memberships SET role = ?, version = version + 1
               WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
              [member.role, caller.appId, existing.id],
            )
          }
          continue
        }
        if (existing) {
          await tx.query(
            `UPDATE mip_game_team_memberships SET status = 'LEFT', left_at = CURRENT_TIMESTAMP(3),
               version = version + 1 WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
            [caller.appId, existing.id],
          )
        }
        await tx.query(
          `INSERT INTO mip_game_team_memberships (
             id, app_id, season_id, team_id, user_id, role, status
           ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
          [createId(), caller.appId, seasonId, teamId, member.userId, member.role],
        )
      }
      await tx.query(
        `UPDATE mip_game_teams SET version = version + 1, updated_by_user_id = ?
         WHERE app_id = ? AND id = ? AND version = ?`,
        [caller.userId, caller.appId, teamId, version],
      )
      await writeAudit(tx, caller, roleKey, 'game.team.members_replaced', 'GAME_TEAM', teamId)
      return { teamId, memberCount: memberIds.length, version: version + 1 }
    })
  }

  async function listAdminMatches(caller, event = {}) {
    await assertGameAdmin(database, caller)
    const seasonId = requiredId(event.seasonId)
    const rows = await database.query(
      `SELECT game.*, team_a.name AS team_a_name, team_b.name AS team_b_name
       FROM mip_game_weekly_matches game
       INNER JOIN mip_game_teams team_a ON team_a.app_id = game.app_id AND team_a.id = game.team_a_id
       INNER JOIN mip_game_teams team_b ON team_b.app_id = game.app_id AND team_b.id = game.team_b_id
       WHERE game.app_id = ? AND game.season_id = ? ORDER BY game.week_start DESC, game.id DESC`,
      [caller.appId, seasonId],
    )
    return { items: rows.map(matchDto) }
  }

  async function saveWeeklyMatch(caller, event = {}) {
    const draft = normalizeMatch(event.match)
    const matchId = createId()
    return database.transaction(async (tx) => {
      const roleKey = await assertGameAdmin(tx, caller, true)
      const season = await tx.one(
        `SELECT status, starts_at, ends_at FROM mip_game_seasons WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, draft.seasonId],
      )
      if (!season) throw new Error('NOT_FOUND')
      if (season.status === 'CLOSED') throw new Error('INVALID_STATE')
      if (draft.weekStart < dateValue(season.starts_at) || draft.weekEnd > dateValue(season.ends_at)) {
        throw new Error('VALIDATION_FAILED')
      }
      const teams = await tx.query(
        `SELECT id FROM mip_game_teams
         WHERE app_id = ? AND season_id = ? AND id IN (?, ?) AND status = 'ACTIVE' FOR UPDATE`,
        [caller.appId, draft.seasonId, draft.teamAId, draft.teamBId],
      )
      if (!Array.isArray(teams) || teams.length !== 2) throw new Error('NOT_FOUND')
      await tx.query(
        `INSERT INTO mip_game_weekly_matches (
           id, app_id, season_id, week_start, week_end, team_a_id, team_b_id, created_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [matchId, caller.appId, draft.seasonId, draft.weekStart, draft.weekEnd, draft.teamAId, draft.teamBId, caller.userId],
      )
      await writeAudit(tx, caller, roleKey, 'game.match.created', 'GAME_MATCH', matchId)
      return matchDto(await matchRow(tx, caller.appId, matchId))
    })
  }

  async function finalizeWeeklyMatch(caller, event = {}) {
    const matchId = requiredId(event.matchId)
    const version = expectedVersion(event.expectedVersion)
    return database.transaction(async (tx) => {
      const roleKey = await assertGameAdmin(tx, caller, true)
      const current = await tx.one(
        `SELECT * FROM mip_game_weekly_matches WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, matchId],
      )
      if (!current) throw new Error('NOT_FOUND')
      if (current.status !== 'SCHEDULED') throw new Error('INVALID_STATE')
      if (Number(current.version) !== version) throw new Error('CONFLICT')
      if (dateValue(current.week_end) >= new Date().toISOString().slice(0, 10)) throw new Error('INVALID_STATE')
      const rangeStart = `${dateValue(current.week_start)} 00:00:00.000`
      const rangeEnd = `${dateValue(current.week_end)} 23:59:59.999`
      const teamAScore = await teamExperience(
        tx, caller.appId, current.season_id, current.team_a_id, rangeStart, rangeEnd,
      )
      const teamBScore = await teamExperience(
        tx, caller.appId, current.season_id, current.team_b_id, rangeStart, rangeEnd,
      )
      const result = await tx.query(
        `UPDATE mip_game_weekly_matches SET team_a_score = ?, team_b_score = ?, status = 'FINALIZED',
           finalized_at = CURRENT_TIMESTAMP(3), version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [teamAScore, teamBScore, caller.appId, matchId, version],
      )
      if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
      await writeAudit(tx, caller, roleKey, 'game.match.finalized', 'GAME_MATCH', matchId)
      return matchDto(await matchRow(tx, caller.appId, matchId))
    })
  }

  async function generateRankingSnapshot(caller, event = {}) {
    const seasonId = requiredId(event.seasonId)
    const type = rankingType(event.rankingType)
    return database.transaction(async (tx) => {
      const roleKey = await assertGameAdmin(tx, caller, true)
      const season = await tx.one(
        `SELECT * FROM mip_game_seasons WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, seasonId],
      )
      if (!season) throw new Error('NOT_FOUND')
      const period = rankingPeriod(season, type)
      const sourceRows = type.startsWith('TEAM_')
        ? await teamRankingRows(tx, caller.appId, season, period)
        : await individualRankingRows(tx, caller.appId, season, period, type)
      await tx.query(
        `UPDATE mip_game_ranking_snapshots SET status = 'ARCHIVED', version = version + 1
         WHERE app_id = ? AND season_id = ? AND ranking_type = ? AND status = 'CURRENT'`,
        [caller.appId, seasonId, type],
      )
      const snapshotId = createId()
      await tx.query(
        `INSERT INTO mip_game_ranking_snapshots (
           id, app_id, season_id, ranking_type, period_key, period_start, period_end, generated_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [snapshotId, caller.appId, seasonId, type, period.key, period.start, period.end, caller.userId],
      )
      const levels = type.startsWith('INDIVIDUAL_')
        ? await tx.query(
            `SELECT name, minimum_experience FROM mip_growth_levels
             WHERE app_id = ? AND status = 'ACTIVE' ORDER BY minimum_experience`,
            [caller.appId],
          )
        : []
      for (const [index, row] of sourceRows.slice(0, 500).entries()) {
        const level = type.startsWith('INDIVIDUAL_') ? growthLevel(Number(row.score), levels) : null
        await tx.query(
          `INSERT INTO mip_game_ranking_entries (
             app_id, snapshot_id, rank_no, subject_type, team_id, user_id, branch_id,
             display_name_snapshot, score, level_number, level_label
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [caller.appId, snapshotId, index + 1, type.startsWith('TEAM_') ? 'TEAM' : 'USER',
            row.team_id || null, row.user_id || null, row.branch_id || null,
            row.display_name, Number(row.score), level?.number || null, level?.label || null],
        )
      }
      await writeAudit(tx, caller, roleKey, 'game.ranking.generated', 'GAME_RANKING', snapshotId)
      return { snapshotId, rankingType: type, entryCount: Math.min(sourceRows.length, 500), generatedAt: new Date().toISOString() }
    })
  }

  return {
    changeSeasonStatus,
    finalizeWeeklyMatch,
    generateRankingSnapshot,
    getAdminSession,
    getOverview,
    getRules,
    getTeam,
    listAdminMatches,
    listAdminRankings,
    listAssignableMembers,
    listHistory,
    listRankings,
    listSeasons,
    listTeams,
    replaceTeamMembers,
    saveSeason,
    saveTeam,
    saveWeeklyMatch,
  }
}

async function assertGameAdmin(database, caller, lock = false) {
  const row = await database.one(
    `SELECT role_key FROM mip_admin_role_bindings
     WHERE app_id = ? AND user_id = ? AND scope_type = 'PLATFORM' AND scope_id = ?
       AND status = 'ACTIVE' AND role_key IN ('PLATFORM_OWNER', 'PLATFORM_OPERATIONS')
     ORDER BY role_key ${lock ? 'FOR UPDATE' : ''}`,
    [caller.appId, caller.userId, PLATFORM_SCOPE_ID],
  )
  if (!row || !GAME_ADMIN_ROLES.has(row.role_key)) throw new Error('FORBIDDEN')
  return row.role_key
}

async function teamExperience(database, appId, seasonId, teamId, startsAt, endsAt) {
  const row = await database.one(
    `SELECT COALESCE(SUM(entry.delta_value), 0) AS score
     FROM mip_game_team_memberships member
     INNER JOIN mip_growth_entries entry
       ON entry.app_id = member.app_id AND entry.user_id = member.user_id
      AND entry.metric = 'EXPERIENCE' AND entry.created_at >= ? AND entry.created_at <= ?
      AND entry.created_at >= member.joined_at
      AND (member.left_at IS NULL OR entry.created_at < member.left_at)
     WHERE member.app_id = ? AND member.season_id = ? AND member.team_id = ?`,
    [startsAt, endsAt, appId, seasonId, teamId],
  )
  return Number(row?.score || 0)
}

async function teamRankingRows(database, appId, season, period) {
  return database.query(
    `SELECT team.id AS team_id, team.branch_id, team.name AS display_name,
            COALESCE(SUM(entry.delta_value), 0) AS score
     FROM mip_game_teams team
     LEFT JOIN mip_game_team_memberships member
       ON member.app_id = team.app_id AND member.season_id = team.season_id AND member.team_id = team.id
     LEFT JOIN mip_growth_entries entry
       ON entry.app_id = member.app_id AND entry.user_id = member.user_id
      AND entry.metric = 'EXPERIENCE' AND entry.created_at >= ? AND entry.created_at <= ?
      AND entry.created_at >= member.joined_at
      AND (member.left_at IS NULL OR entry.created_at < member.left_at)
     WHERE team.app_id = ? AND team.season_id = ? AND team.status = 'ACTIVE'
     GROUP BY team.id, team.branch_id, team.name
     ORDER BY score DESC, team.name, team.id`,
    [period.start, period.end, appId, season.id],
  )
}

async function individualRankingRows(database, appId, season, period, type) {
  if (type === 'INDIVIDUAL_ALL_TIME') {
    return database.query(
      `SELECT user.id AS user_id, user.primary_branch_id AS branch_id,
              COALESCE(profile.nickname, '未设置昵称') AS display_name,
              COALESCE(account.experience_balance, 0) AS score
       FROM mip_users user
       LEFT JOIN mip_profiles profile ON profile.app_id = user.app_id AND profile.user_id = user.id
       LEFT JOIN mip_growth_accounts account ON account.app_id = user.app_id AND account.user_id = user.id
       WHERE user.app_id = ? AND user.status = 'ACTIVE'
         AND EXISTS (
           SELECT 1 FROM mip_membership_entitlements entitlement
           WHERE entitlement.app_id = user.app_id AND entitlement.user_id = user.id
             AND entitlement.status = 'ACTIVE' AND entitlement.starts_at <= UTC_TIMESTAMP(3)
             AND entitlement.ends_at > UTC_TIMESTAMP(3)
         )
       ORDER BY score DESC, display_name, user.id`,
      [appId],
    )
  }
  return database.query(
    `SELECT user.id AS user_id, user.primary_branch_id AS branch_id,
            COALESCE(profile.nickname, '未设置昵称') AS display_name,
            COALESCE(SUM(entry.delta_value), 0) AS score
     FROM mip_users user
     LEFT JOIN mip_profiles profile ON profile.app_id = user.app_id AND profile.user_id = user.id
     LEFT JOIN mip_growth_entries entry
       ON entry.app_id = user.app_id AND entry.user_id = user.id AND entry.metric = 'EXPERIENCE'
      AND entry.created_at >= ? AND entry.created_at <= ?
     WHERE user.app_id = ? AND user.status = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM mip_membership_entitlements entitlement
         WHERE entitlement.app_id = user.app_id AND entitlement.user_id = user.id
           AND entitlement.status = 'ACTIVE' AND entitlement.starts_at <= UTC_TIMESTAMP(3)
           AND entitlement.ends_at > UTC_TIMESTAMP(3)
       )
     GROUP BY user.id, user.primary_branch_id, profile.nickname
     ORDER BY score DESC, display_name, user.id`,
    [period.start, period.end, appId],
  )
}

function rankingPeriod(season, type) {
  if (type === 'INDIVIDUAL_ALL_TIME') {
    return { key: 'all-time', start: '1970-01-01 00:00:00.000', end: season.ends_at }
  }
  if (type === 'TEAM_HALF_YEAR') {
    return {
      key: `${String(season.season_key)}:team_half_year`,
      start: calendarMonthsBefore(season.ends_at, 6),
      end: season.ends_at,
    }
  }
  if (type === 'TEAM_YEAR') {
    return {
      key: `${String(season.season_key)}:team_year`,
      start: calendarMonthsBefore(season.ends_at, 12),
      end: season.ends_at,
    }
  }
  return {
    key: `${String(season.season_key)}:${type.toLowerCase()}`,
    start: season.starts_at,
    end: season.ends_at,
  }
}

function calendarMonthsBefore(value, months) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/)
  if (!match) throw new Error('INVALID_STATE')
  const monthIndex = Number(match[1]) * 12 + Number(match[2]) - 1 - months
  const year = Math.floor(monthIndex / 12)
  const month = monthIndex - year * 12
  const maximumDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(Number(match[3]), maximumDay)
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}${match[4]}`
}

async function matchRow(database, appId, matchId) {
  return database.one(
    `SELECT game.*, team_a.name AS team_a_name, team_b.name AS team_b_name
     FROM mip_game_weekly_matches game
     INNER JOIN mip_game_teams team_a ON team_a.app_id = game.app_id AND team_a.id = game.team_a_id
     INNER JOIN mip_game_teams team_b ON team_b.app_id = game.app_id AND team_b.id = game.team_b_id
     WHERE game.app_id = ? AND game.id = ?`,
    [appId, matchId],
  )
}

function seasonDto(row) {
  return {
    id: row.id,
    seasonKey: row.season_key,
    name: row.name,
    summary: row.summary || '',
    rulesText: row.rules_text,
    rules: parseRules(row.rules_json),
    periodKind: row.period_kind,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    status: row.status,
    version: Number(row.version),
  }
}

function teamDto(row, season = null) {
  const score = Number(row.score || 0)
  return {
    id: row.id,
    seasonId: row.season_id,
    branchId: row.branch_id || '',
    branchName: row.branch_name || '',
    name: row.name,
    summary: row.summary || '',
    status: row.status,
    version: Number(row.version),
    memberCount: Number(row.member_count || 0),
    headquartersLevel: headquartersLevel(score, parseRules(season?.rules_json)),
  }
}

function matchDto(row) {
  const a = row.team_a_score === null || row.team_a_score === undefined ? null : Number(row.team_a_score)
  const b = row.team_b_score === null || row.team_b_score === undefined ? null : Number(row.team_b_score)
  return {
    id: row.id,
    seasonId: row.season_id,
    weekStart: dateValue(row.week_start),
    weekEnd: dateValue(row.week_end),
    teamA: { id: row.team_a_id, name: row.team_a_name, score: a },
    teamB: { id: row.team_b_id, name: row.team_b_name, score: b },
    winnerTeamId: a === null || b === null || a === b ? '' : (a > b ? row.team_a_id : row.team_b_id),
    status: row.status,
    finalizedAt: iso(row.finalized_at),
    version: Number(row.version),
  }
}

function rankingEntryDto(row) {
  return {
    rank: Number(row.rank_no),
    subjectType: row.subject_type,
    teamId: row.team_id || '',
    displayName: row.display_name_snapshot,
    score: Number(row.score),
    branchId: row.branch_id || '',
    branchName: row.branch_name || '',
    levelNumber: row.level_number === null ? null : Number(row.level_number),
    levelLabel: row.level_label || '',
  }
}

function branchDto(row) { return { id: row.id, name: row.name, cityName: row.city_name } }

function parseRules(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value || '{}') }
  catch { return { scoreMetric: 'EXPERIENCE', headquartersThresholds: [{ level: 1, minimumExperience: 0, label: '一级大本营' }] } }
}

function headquartersLevel(score, rules) {
  const thresholds = Array.isArray(rules?.headquartersThresholds) ? rules.headquartersThresholds : []
  const selected = thresholds.filter(item => Number(item.minimumExperience) <= score).at(-1)
    || { level: 1, minimumExperience: 0, label: '一级大本营' }
  return {
    number: Number(selected.level),
    label: String(selected.label),
    minimumExperience: Number(selected.minimumExperience),
    styleKey: `BASE_${Number(selected.level)}`,
  }
}

function growthLevel(score, levels) {
  let result = null
  for (const [index, level] of levels.entries()) {
    if (Number(level.minimum_experience) <= score) result = { number: index + 1, label: level.name }
  }
  return result
}

async function writeAudit(database, caller, roleKey, action, resourceType, resourceId) {
  await database.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id, action,
       resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, 'ADMIN', 'PLATFORM', ?, ?, ?, ?, ?, JSON_OBJECT())`,
    [caller.appId, caller.userId, PLATFORM_SCOPE_ID, action, resourceType, resourceId, roleKey],
  )
}

function iso(value) { return value ? new Date(value).toISOString() : '' }
function dateValue(value) { return value ? new Date(value).toISOString().slice(0, 10) : '' }

module.exports = {
  GAME_CAPABILITY,
  createGameRepository,
  headquartersLevel,
  rankingPeriod,
  teamExperience,
}
