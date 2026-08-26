'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('GROWTH', [
  serviceOperation('mip.admin.growth.levels', 'QUERY', 'listGrowthLevels'),
  serviceOperation('mip.admin.growth.benefits', 'QUERY', 'listGrowthBenefits'),
  serviceOperation('mip.admin.growth.rules', 'QUERY', 'listGrowthRules'),
  serviceOperation('mip.admin.growth.entries', 'QUERY', 'listGrowthEntries'),
  serviceOperation('mip.admin.growth.levelTransitions', 'QUERY', 'listGrowthLevelTransitions'),
  serviceOperation('mip.admin.badges.list', 'QUERY', 'listBadges'),
  serviceOperation('mip.admin.badges.awards', 'QUERY', 'listBadgeAwards'),
  serviceOperation('mip.admin.growth.saveBenefit', 'MUTATION', 'saveGrowthBenefit'),
  serviceOperation('mip.admin.growth.saveLevel', 'MUTATION', 'saveGrowthLevel'),
  serviceOperation('mip.admin.growth.saveRule', 'MUTATION', 'saveGrowthRule'),
  serviceOperation('mip.admin.growth.adjust', 'MUTATION', 'adjustGrowth', { wakesOutbox: true }),
  serviceOperation('mip.admin.badges.save', 'MUTATION', 'saveBadge'),
  serviceOperation('mip.admin.badges.grant', 'MUTATION', 'grantBadge'),
  serviceOperation('mip.admin.badges.revoke', 'MUTATION', 'revokeBadge'),
])
