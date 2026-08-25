'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('KNOWLEDGE', [
  serviceOperation('mip.admin.knowledge.list', 'QUERY', 'listKnowledgeAdmin', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.get', 'QUERY', 'getKnowledgeAdminContent', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.sources.save', 'MUTATION', 'saveKnowledgeSource', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.categories.save', 'MUTATION', 'saveKnowledgeCategory', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.contents.save', 'MUTATION', 'saveKnowledgeContent', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.contents.review', 'MUTATION', 'reviewKnowledgeContent', {
    sessionFirst: true,
    wakesOutbox: true,
  }),
  serviceOperation('mip.admin.knowledge.products.save', 'MUTATION', 'saveKnowledgeProduct', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.comments.moderate', 'MUTATION', 'moderateKnowledgeComment', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.reports.close', 'MUTATION', 'closeKnowledgeCommentReport', { sessionFirst: true }),
  serviceOperation('mip.admin.knowledge.ingestion.run', 'MUTATION', 'runKnowledgeIngestion', { sessionFirst: true }),
])
