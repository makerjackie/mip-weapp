'use strict'

function createGrowthService(repository) {
  return {
    getSnapshot: caller => repository.getSnapshot(caller.appId, caller.userId),
    listEntries: (caller, event) => repository.listEntries(caller.appId, caller.userId, event),
    applyCheckInTransition: input => repository.applyCheckInTransition(input),
    recordConfirmedEvent: input => repository.recordConfirmedEvent(input),
  }
}

module.exports = { createGrowthService }
