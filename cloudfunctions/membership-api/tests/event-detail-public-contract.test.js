'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
const getEventSource = source.slice(
  source.indexOf('async function getEvent('),
  source.indexOf('async function listOrders('),
)

describe('public event detail contract', () => {
  it('loads the event owner from the current app and event only', () => {
    assert.match(getEventSource, /manager\.app_id = \? AND manager\.event_id = \?/)
    assert.match(getEventSource, /manager\.role = 'EVENT_OWNER'/)
    assert.match(getEventSource, /manager\.status = 'ACTIVE'/)
    assert.match(getEventSource, /profile\.app_id = manager\.app_id/)
    assert.match(getEventSource, /profile\.user_id = manager\.user_id/)
    assert.match(getEventSource, /profile\.status = 'APPROVED'/)
  })

  it('returns only the approved public organizer profile', () => {
    const organizerBlock = getEventSource.slice(
      getEventSource.indexOf('organizer: eventOwner'),
      getEventSource.indexOf('venueName:'),
    )
    assert.match(organizerBlock, /id: eventOwner\.id/)
    assert.match(organizerBlock, /nickname: eventOwner\.nickname/)
    assert.match(organizerBlock, /headline: eventOwner\.headline/)
    assert.match(organizerBlock, /avatarUrl:/)
    assert.doesNotMatch(organizerBlock, /user[_I]d|open[_I]d/i)
  })
})
