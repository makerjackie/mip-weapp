'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('COOPERATION_CARDS', [
  serviceOperation('mip.admin.cooperationCards.get', 'QUERY', 'getCooperationCard', { sessionFirst: true }),
  serviceOperation('mip.admin.cooperationCards.save', 'MUTATION', 'saveCooperationCard', { sessionFirst: true }),
])
