'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertCandidateRef,
  candidateRefEquals,
  createCandidateRef,
} = require('../lib/matching-candidate-ref')

const SECRET = 'matching-reference-secret-with-32-characters'
const input = {
  appId: 'wx-matching-test',
  requestId: '10000000-0000-4000-8000-000000000001',
  resultVersion: 1,
  candidateType: 'TALENT',
  candidateId: '20000000-0000-4000-8000-000000000001',
}

describe('matching candidate references', () => {
  it('is stable inside one request but unlinkable across random request ids', () => {
    const reference = createCandidateRef(input, SECRET)
    const anotherRequest = createCandidateRef({
      ...input,
      requestId: '30000000-0000-4000-8000-000000000001',
    }, SECRET)

    assert.equal(reference, createCandidateRef(input, SECRET))
    assert.notEqual(reference, anotherRequest)
    assert.equal(reference.includes(input.candidateId), false)
    assert.match(reference, /^mc1\.[\w-]{43}$/)
  })

  it('compares valid references safely and rejects malformed or unconfigured references', () => {
    const reference = createCandidateRef(input, SECRET)
    const tampered = `${reference.slice(0, -1)}${reference.endsWith('A') ? 'B' : 'A'}`
    assert.equal(candidateRefEquals(reference, reference), true)
    assert.equal(candidateRefEquals(reference, tampered), false)
    assert.throws(() => assertCandidateRef(input.candidateId), /VALIDATION_FAILED/)
    assert.throws(() => createCandidateRef(input, 'short'), /MATCHING_CONFIG_REQUIRED/)
  })
})
