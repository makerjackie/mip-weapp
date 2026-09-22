'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('VIDEOS', [
  serviceOperation('mip.admin.videos.list', 'QUERY', 'listVideos', { sessionFirst: true }),
  serviceOperation('mip.admin.videos.save', 'MUTATION', 'saveVideo', { sessionFirst: true }),
  serviceOperation('mip.admin.videos.changeStatus', 'MUTATION', 'changeVideoStatus', { sessionFirst: true }),
])
