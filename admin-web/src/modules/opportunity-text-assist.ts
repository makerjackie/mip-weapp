import type { OperationValues } from './admin-operation-ui'

const headings: Record<string, string> = { 标题: 'title', 简介: 'summary', 摘要: 'summary', 合作需求: 'targetSummary', 目标: 'targetSummary', 价值说明: 'valueSummary', 正文: 'description', 详情: 'description' }

/** Only extract explicitly labelled text. Scope, publisher and money require manual selection. */
export function opportunityTextSuggestions(source: string): OperationValues {
  const text = source.trim()
  if (!text || text.length > 8000) throw new Error('请填写 8000 字以内的机会说明')
  const draft: Record<string, string> = {}
  let field = 'description'
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(标题|简介|摘要|合作需求|目标|价值说明|正文|详情)[：:]\s*(.*)$/)
    if (match) field = headings[match[1]]
    const value = match ? match[2] : line
    draft[field] = draft[field] === undefined ? value : `${draft[field]}\n${value}`
  }
  return { draft: Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)) }
}
