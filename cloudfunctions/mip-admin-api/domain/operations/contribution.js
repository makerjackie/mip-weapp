'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('CONTRIBUTION', [
  serviceOperation('mip.admin.contribution.rules.list', 'QUERY', 'listContributionRules', { sessionFirst: true }),
  serviceOperation('mip.admin.contribution.rules.save', 'MUTATION', 'saveContributionRule', { sessionFirst: true }),
  serviceOperation('mip.admin.contribution.transactions.list', 'QUERY', 'listContributionTransactions', { sessionFirst: true }),
  serviceOperation('mip.admin.contribution.transactions.reverse', 'MUTATION', 'reverseContribution', { sessionFirst: true }),
])
