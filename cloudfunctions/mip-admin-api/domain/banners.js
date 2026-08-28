'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')

function createAdminBanners({ access, client } = {}) {
  if (!access || typeof access.session !== 'function' || !client || typeof client.execute !== 'function') {
    throw new Error('BANNERS_ADAPTER_CONFIG_INVALID')
  }

  async function execute(caller, action, input) {
    const context = await access.session(caller)
    authorize(context.bindings, CAPABILITIES.BANNERS_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    return client.execute({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      action,
      input,
    })
  }

  return Object.freeze({
    getBannerSession: (caller, input) => execute(caller, 'mip.admin.banners.session', input),
    listBanners: (caller, input) => execute(caller, 'mip.admin.banners.list', input),
    getBanner: (caller, input) => execute(caller, 'mip.admin.banners.get', input),
    saveBanner: (caller, input) => execute(caller, 'mip.admin.banners.save', input),
    changeBannerStatus: (caller, input) => execute(caller, 'mip.admin.banners.changeStatus', input),
    moveBanner: (caller, input) => execute(caller, 'mip.admin.banners.move', input),
    deleteBanner: (caller, input) => execute(caller, 'mip.admin.banners.delete', input),
  })
}

module.exports = { createAdminBanners }
