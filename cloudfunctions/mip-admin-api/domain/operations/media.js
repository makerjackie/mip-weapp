'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('MEDIA', [
  serviceOperation('mip.admin.media.uploadImage', 'MUTATION', 'uploadMediaImage', { sessionFirst: true }),
  serviceOperation('mip.admin.media.tempUrls', 'QUERY', 'tempMediaFileUrls', { sessionFirst: true }),
])
