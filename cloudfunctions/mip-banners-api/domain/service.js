'use strict'

function createBannerService(repository, contentSafety) {
  return {
    getAdminSession: caller => repository.getAdminSession(caller),
    listActive: appId => repository.listActive(appId),
    listAdmin: (caller, event) => repository.listAdmin(caller, event),
    getAdmin: (caller, event) => repository.getAdmin(caller, event),
    async save(caller, event) {
      await repository.getAdminSession(caller)
      await contentSafety.assertSafe(caller, [event?.banner?.title, event?.banner?.accessibilityLabel])
      return repository.save(caller, event)
    },
    async changeStatus(caller, event) {
      if (String(event?.status || '').trim().toUpperCase() === 'ACTIVE') {
        const current = await repository.getAdmin(caller, event)
        await contentSafety.assertSafe(caller, [current.title, current.accessibilityLabel])
      }
      return repository.changeStatus(caller, event)
    },
    move: (caller, event) => repository.move(caller, event),
    remove: (caller, event) => repository.remove(caller, event),
  }
}

module.exports = { createBannerService }
