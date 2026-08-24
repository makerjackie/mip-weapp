'use strict'

function createGameService(repository) {
  return {
    listBlindBoxes: caller => repository.listBlindBoxes(caller),
    getBlindBox: (caller, event) => repository.getBlindBox(caller, event),
    drawBlindBox: (caller, event) => repository.drawBlindBox(caller, event),
    getBlindBoxInventory: (caller, event) => repository.getBlindBoxInventory(caller, event),
    listBlindBoxCoinEntries: (caller, event) => repository.listBlindBoxCoinEntries(caller, event),
    getOverview: (caller, event) => repository.getOverview(caller, event),
    getRules: (caller, event) => repository.getRules(caller, event),
    getTeam: (caller, event) => repository.getTeam(caller, event),
    listHistory: (caller, event) => repository.listHistory(caller, event),
    listRankings: (caller, event) => repository.listRankings(caller, event),
    getAdminSession: caller => repository.getAdminSession(caller),
    listAdminRankings: (caller, event) => repository.listAdminRankings(caller, event),
    listSeasons: caller => repository.listSeasons(caller),
    saveSeason: (caller, event) => repository.saveSeason(caller, event),
    changeSeasonStatus: (caller, event) => repository.changeSeasonStatus(caller, event),
    listTeams: (caller, event) => repository.listTeams(caller, event),
    saveTeam: (caller, event) => repository.saveTeam(caller, event),
    listAssignableMembers: (caller, event) => repository.listAssignableMembers(caller, event),
    replaceTeamMembers: (caller, event) => repository.replaceTeamMembers(caller, event),
    listAdminMatches: (caller, event) => repository.listAdminMatches(caller, event),
    saveWeeklyMatch: (caller, event) => repository.saveWeeklyMatch(caller, event),
    finalizeWeeklyMatch: (caller, event) => repository.finalizeWeeklyMatch(caller, event),
    generateRankingSnapshot: (caller, event) => repository.generateRankingSnapshot(caller, event),
    adminListBlindBoxCatalogs: caller => repository.adminListBlindBoxCatalogs(caller),
    adminSaveBlindBoxCatalog: (caller, event) => repository.adminSaveBlindBoxCatalog(caller, event),
    adminChangeBlindBoxCatalogStatus: (caller, event) => repository.adminChangeBlindBoxCatalogStatus(caller, event),
    adminListBlindBoxCards: (caller, event) => repository.adminListBlindBoxCards(caller, event),
    adminSaveBlindBoxCard: (caller, event) => repository.adminSaveBlindBoxCard(caller, event),
    adminChangeBlindBoxCardStatus: (caller, event) => repository.adminChangeBlindBoxCardStatus(caller, event),
  }
}

module.exports = { createGameService }
