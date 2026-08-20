'use strict'

const TRANSITIONS = Object.freeze({
  APPROVED: new Set(['SUSPENDED']),
  SUSPENDED: new Set(['APPROVED']),
})

function assertProfileTransition(from, to) {
  if (!TRANSITIONS[from] || !TRANSITIONS[from].has(to)) {
    throw new Error('INVALID_PROFILE_TRANSITION')
  }
}

module.exports = { assertProfileTransition }
