'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { normalizeStructuredDraft, normalizeTextIntent, normalizeVoiceUploadIntent } = require('../domain/validation')

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
})
