'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { projectEventTags } = require('../domain/tag-contract')
it('keeps old clients compatible while all new read surfaces receive the same selected tag colors', () => {
  const event = { tags: ['test'], tagStyles: [{ name: 'test', backgroundColor: '#ff4d5e', textColor: '#ffffff' }], memberFree: true }
  for (const [action, data] of [['mip.events.detail', event], ['mip.events.list', { items: [event] }], ['mip.events.mine', { items: [{ event, status: 'REGISTERED' }] }]]) {
    assert.equal(projectEventTags(action, data, 1), data)
    assert.equal(JSON.stringify(projectEventTags(action, data)).includes('tagStyles'), false)
    assert.equal(JSON.stringify(projectEventTags(action, data)).includes('memberFree'), true)
  }
})
