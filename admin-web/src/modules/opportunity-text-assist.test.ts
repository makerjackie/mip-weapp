import assert from 'node:assert/strict'
import { it } from 'node:test'
import { opportunityTextSuggestions } from './opportunity-text-assist.ts'

it('extracts labelled multiline text without inventing money, scope or publisher', () => {
  assert.deepEqual(opportunityTextSuggestions('标题：联合开发\n合作需求：第一行\n第二行\n详情：内容一\n内容二'), { draft: { title: '联合开发', targetSummary: '第一行\n第二行', description: '内容一\n内容二' } })
  assert.deepEqual(opportunityTextSuggestions('价值 20 万元，由王同学发布'), { draft: { description: '价值 20 万元，由王同学发布' } })
  assert.throws(() => opportunityTextSuggestions(' '))
})
