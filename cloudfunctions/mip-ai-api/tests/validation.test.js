'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  combineDraftTranscript,
  normalizeRefinementIntent,
  normalizeStructuredDraft,
  normalizeTextIntent,
  normalizeVoiceUploadIntent,
} = require('../domain/validation')

test('keeps only supported fields for the selected draft purpose', () => {
  assert.deepEqual(normalizeStructuredDraft('PROFILE', {
    headline: '产品负责人',
    introduction: '负责产品设计与交付。',
    adminRole: 'PLATFORM_OWNER',
  }), {
    headline: '产品负责人',
    introduction: '负责产品设计与交付。',
  })
})

test('validates text and voice-upload intents without inventing a transcript', () => {
  assert.deepEqual(normalizeTextIntent({ purpose: 'SUPER_CASE', transcriptText: ' 项目内容 ' }), {
    purpose: 'SUPER_CASE',
    transcriptText: '项目内容',
  })
  assert.deepEqual(normalizeVoiceUploadIntent({
    purpose: 'COOPERATION_CARD',
    audioBase64: 'SUQzAA==',
    contentType: 'audio/mpeg',
  }).purpose, 'COOPERATION_CARD')
  assert.throws(() => normalizeVoiceUploadIntent({
    purpose: 'PROFILE',
    audioBase64: 'SUQzAA==',
    contentType: 'audio/wav',
  }), /VALIDATION_FAILED/)
  assert.equal(normalizeTextIntent({
    purpose: 'PROFILE',
    transcriptText: '资料',
    requestId: ' ai-draft:text-one ',
  }).requestId, 'ai-draft:text-one')
  assert.throws(() => normalizeTextIntent({
    purpose: 'PROFILE',
    transcriptText: '资料',
    requestId: 'short',
  }), /VALIDATION_FAILED/)
})

test('normalizes a bounded refinement turn and appends it without provider rewriting the source', () => {
  assert.deepEqual(normalizeRefinementIntent({
    draftId: '20000000-0000-4000-8000-000000000001',
    expectedVersion: 4,
    supplementalText: ' 补充第二轮内容 ',
  }), {
    draftId: '20000000-0000-4000-8000-000000000001',
    expectedVersion: 4,
    supplementalText: '补充第二轮内容',
  })
  assert.equal(combineDraftTranscript('第一轮内容', '补充第二轮内容'), '第一轮内容\n\n补充第二轮内容')
  assert.throws(() => normalizeRefinementIntent({
    draftId: '20000000-0000-4000-8000-000000000001',
    expectedVersion: 4,
    supplementalText: ' ',
  }), /VALIDATION_FAILED/)
  assert.throws(() => combineDraftTranscript('a'.repeat(19_999), 'bb'), /AI_DRAFT_CONTENT_INVALID/)
})
