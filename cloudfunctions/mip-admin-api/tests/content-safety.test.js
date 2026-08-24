'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { checkCompleteContentSafety } = require('../lib/content-safety')

async function safetyFor(body) {
  const checked = []
  const status = await checkCompleteContentSafety(
    { title: '标题', summary: '摘要', body },
    { openId: 'openid' },
    async (input) => {
      checked.push(input.content)
      return { errCode: 0, result: { suggest: input.content.includes('UNSAFE') ? 'risky' : 'pass' } }
    },
  )
  return { checked, status }
}

describe('complete knowledge content safety', () => {
  it('checks prohibited content after character 4000', async () => {
    const result = await safetyFor(`${'a'.repeat(4_001)}UNSAFE`)
    assert.equal(result.status, 'REJECTED')
    assert.ok(result.checked.length >= 3)
  })

  it('overlaps chunks so a prohibited phrase spanning a boundary is checked intact', async () => {
    const result = await safetyFor(`${'a'.repeat(1_995)}UNSAFE${'b'.repeat(200)}`)
    assert.equal(result.status, 'REJECTED')
    assert.equal(result.checked.some(chunk => chunk.includes('UNSAFE')), true)
  })

  it('checks the final partial segment', async () => {
    const result = await safetyFor(`${'a'.repeat(6_500)}UNSAFE`)
    assert.equal(result.status, 'REJECTED')
    assert.equal(result.checked.at(-1).includes('UNSAFE'), true)
  })
})
