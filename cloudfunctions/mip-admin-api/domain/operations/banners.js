'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('BANNERS', [
  serviceOperation('mip.admin.banners.session', 'QUERY', 'getBannerSession'),
  serviceOperation('mip.admin.banners.list', 'QUERY', 'listBanners'),
  serviceOperation('mip.admin.banners.get', 'QUERY', 'getBanner'),
  serviceOperation('mip.admin.banners.save', 'MUTATION', 'saveBanner'),
  serviceOperation('mip.admin.banners.changeStatus', 'MUTATION', 'changeBannerStatus'),
  serviceOperation('mip.admin.banners.move', 'MUTATION', 'moveBanner'),
  serviceOperation('mip.admin.banners.delete', 'MUTATION', 'deleteBanner'),
])
