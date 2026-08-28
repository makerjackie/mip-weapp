'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('GAME', [
  serviceOperation('mip.admin.game.session', 'QUERY', 'getGameSession'),
  serviceOperation('mip.admin.game.rankings.list', 'QUERY', 'listGameRankings'),
  serviceOperation('mip.admin.game.seasons.list', 'QUERY', 'listGameSeasons'),
  serviceOperation('mip.admin.game.seasons.save', 'MUTATION', 'saveGameSeason'),
  serviceOperation('mip.admin.game.seasons.changeStatus', 'MUTATION', 'changeGameSeasonStatus'),
  serviceOperation('mip.admin.game.teams.list', 'QUERY', 'listGameTeams'),
  serviceOperation('mip.admin.game.teams.save', 'MUTATION', 'saveGameTeam'),
  serviceOperation('mip.admin.game.teams.changeStatus', 'MUTATION', 'changeGameTeamStatus'),
  serviceOperation('mip.admin.game.members.assignable.list', 'QUERY', 'listGameAssignableMembers'),
  serviceOperation('mip.admin.game.teams.members.replace', 'MUTATION', 'replaceGameTeamMembers'),
  serviceOperation('mip.admin.game.matches.list', 'QUERY', 'listGameMatches'),
  serviceOperation('mip.admin.game.matches.save', 'MUTATION', 'saveGameWeeklyMatch'),
  serviceOperation('mip.admin.game.matches.finalize', 'MUTATION', 'finalizeGameWeeklyMatch'),
  serviceOperation('mip.admin.game.rankings.generate', 'MUTATION', 'generateGameRankingSnapshot'),
  serviceOperation('mip.admin.game.blindBoxes.catalogs.list', 'QUERY', 'listGameBlindBoxCatalogs'),
  serviceOperation('mip.admin.game.blindBoxes.catalogs.save', 'MUTATION', 'saveGameBlindBoxCatalog'),
  serviceOperation('mip.admin.game.blindBoxes.catalogs.changeStatus', 'MUTATION', 'changeGameBlindBoxCatalogStatus'),
  serviceOperation('mip.admin.game.blindBoxes.cards.list', 'QUERY', 'listGameBlindBoxCards'),
  serviceOperation('mip.admin.game.blindBoxes.cards.save', 'MUTATION', 'saveGameBlindBoxCard'),
  serviceOperation('mip.admin.game.blindBoxes.cards.changeStatus', 'MUTATION', 'changeGameBlindBoxCardStatus'),
])
