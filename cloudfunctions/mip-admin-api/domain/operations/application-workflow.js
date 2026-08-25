'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('APPLICATION_WORKFLOW', [
  serviceOperation('mip.admin.dashboard', 'QUERY', 'getDashboard'),
  serviceOperation('mip.admin.exports.status', 'QUERY', 'getExportStatus'),
  serviceOperation('mip.admin.exceptions.list', 'QUERY', 'listOperationalExceptions'),
  serviceOperation('mip.admin.exports.create', 'MUTATION', 'createExport'),
  serviceOperation('mip.admin.exports.prepare', 'MUTATION', 'prepareExport'),
  serviceOperation('mip.admin.exports.reserve', 'MUTATION', 'reserveExportDownload'),
  serviceOperation('mip.admin.exports.complete', 'MUTATION', 'completeExportDownload'),
])
