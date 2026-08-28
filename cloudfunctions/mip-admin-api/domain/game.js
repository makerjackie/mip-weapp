'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')

function createAdminGame({ access, client } = {}) {
  if (!access || typeof access.session !== 'function' || !client || typeof client.execute !== 'function') {
    throw new Error('GAME_ADAPTER_CONFIG_INVALID')
  }

  async function execute(caller, action, input) {
    const context = await access.session(caller)
    authorize(context.bindings, CAPABILITIES.GAME_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    const businessInput = { ...(input || {}) }
    const hasIdempotencyKey = Object.hasOwn(businessInput, 'idempotencyKey')
    const idempotencyKey = businessInput.idempotencyKey
    delete businessInput.idempotencyKey
    return client.execute({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      action,
      input: businessInput,
      ...(hasIdempotencyKey ? { idempotencyKey } : {}),
    })
  }

  return Object.freeze({
    getGameSession: (caller, input) => execute(caller, 'mip.admin.game.session', input),
    listGameRankings: (caller, input) => execute(caller, 'mip.admin.game.rankings.list', input),
    listGameSeasons: (caller, input) => execute(caller, 'mip.admin.game.seasons.list', input),
    saveGameSeason: (caller, input) => execute(caller, 'mip.admin.game.seasons.save', input),
    changeGameSeasonStatus: (caller, input) => execute(caller, 'mip.admin.game.seasons.changeStatus', input),
    listGameTeams: (caller, input) => execute(caller, 'mip.admin.game.teams.list', input),
    saveGameTeam: (caller, input) => execute(caller, 'mip.admin.game.teams.save', input),
    changeGameTeamStatus: (caller, input) => execute(caller, 'mip.admin.game.teams.changeStatus', input),
    listGameAssignableMembers: (caller, input) => execute(caller, 'mip.admin.game.members.assignable.list', input),
    replaceGameTeamMembers: (caller, input) => execute(caller, 'mip.admin.game.teams.members.replace', input),
    listGameMatches: (caller, input) => execute(caller, 'mip.admin.game.matches.list', input),
    saveGameWeeklyMatch: (caller, input) => execute(caller, 'mip.admin.game.matches.save', input),
    finalizeGameWeeklyMatch: (caller, input) => execute(caller, 'mip.admin.game.matches.finalize', input),
    generateGameRankingSnapshot: (caller, input) => execute(caller, 'mip.admin.game.rankings.generate', input),
    listGameBlindBoxCatalogs: (caller, input) => execute(caller, 'mip.admin.game.blindBoxes.catalogs.list', input),
    saveGameBlindBoxCatalog: (caller, input) => execute(caller, 'mip.admin.game.blindBoxes.catalogs.save', input),
    changeGameBlindBoxCatalogStatus: (caller, input) => execute(caller, 'mip.admin.game.blindBoxes.catalogs.changeStatus', input),
    listGameBlindBoxCards: (caller, input) => execute(caller, 'mip.admin.game.blindBoxes.cards.list', input),
    saveGameBlindBoxCard: (caller, input) => execute(caller, 'mip.admin.game.blindBoxes.cards.save', input),
    changeGameBlindBoxCardStatus: (caller, input) => execute(caller, 'mip.admin.game.blindBoxes.cards.changeStatus', input),
  })
}

module.exports = { createAdminGame }
