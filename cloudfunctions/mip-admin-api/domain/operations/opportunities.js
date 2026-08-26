'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('OPPORTUNITIES', [
  serviceOperation('mip.admin.opportunities.list', 'QUERY', 'listOpportunities'),
  serviceOperation('mip.admin.userContent.list', 'QUERY', 'listUserContent'),
  serviceOperation('mip.admin.userContent.get', 'QUERY', 'getUserContent'),
  serviceOperation('mip.admin.opportunities.get', 'QUERY', 'getOpportunity'),
  serviceOperation('mip.admin.opportunities.options', 'QUERY', 'getOpportunityEditorOptions'),
  serviceOperation('mip.admin.matching.get', 'QUERY', 'getMatchingAdminState'),
  serviceOperation('mip.admin.opportunityComments.get', 'QUERY', 'getOpportunityCommentAdminState'),
  serviceOperation('mip.admin.opportunities.save', 'MUTATION', 'saveOpportunity'),
  serviceOperation('mip.admin.opportunities.publish', 'MUTATION', 'publishOpportunity'),
  serviceOperation('mip.admin.opportunities.end', 'MUTATION', 'endOpportunity'),
  serviceOperation('mip.admin.opportunities.unpublish', 'MUTATION', 'unpublishOpportunity'),
  serviceOperation('mip.admin.opportunities.archive', 'MUTATION', 'archiveOpportunity'),
  serviceOperation('mip.admin.userContent.unpublish', 'MUTATION', 'unpublishUserContent'),
  serviceOperation('mip.admin.matching.settings.save', 'MUTATION', 'saveMatchingSettings'),
  serviceOperation('mip.admin.matching.recalculate', 'MUTATION', 'recalculateOpportunityMatching'),
  serviceOperation('mip.admin.opportunityComments.settings.save', 'MUTATION', 'saveOpportunityCommentSettings'),
  serviceOperation('mip.admin.opportunityComments.moderate', 'MUTATION', 'moderateOpportunityComment', { wakesOutbox: true }),
  serviceOperation('mip.admin.opportunityComments.reports.close', 'MUTATION', 'closeOpportunityCommentReport'),
])
