'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('CARDS', [
  serviceOperation('mip.admin.cards.list', 'QUERY', 'listCards', { sessionFirst: true }),
  serviceOperation('mip.admin.cards.save', 'MUTATION', 'saveCard', { sessionFirst: true }),
  serviceOperation('mip.admin.cards.changeStatus', 'MUTATION', 'changeCardStatus', { sessionFirst: true }),
  serviceOperation('mip.admin.cards.takedown', 'MUTATION', 'takedownCard', { sessionFirst: true }),
  serviceOperation('mip.admin.cards.history', 'QUERY', 'listCardHistory', { sessionFirst: true }),
])
