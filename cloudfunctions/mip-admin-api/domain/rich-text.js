'use strict'

const { AdminError } = require('./validation')

// 活动图文（活动介绍 / 主办方介绍 / 报名须知）以「受限 HTML」存储。
// 编辑器与小程序端都会按白名单解析，这里在服务端做最后一道防线：
// 不重写内容（避免误伤合法富文本），只拒绝明显可执行/可外链注入的结构。
const DANGEROUS_PATTERNS = [
  /<\s*\/?\s*(?:script|style|iframe|object|embed|link|meta|base|form|input|svg)\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
]

/** 富文本 → 纯文本，用于内容安全送审与长度估计（避免把 HTML 标签喂给 msgSecCheck）。 */
function richTextToPlainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|h[1-6]|ul|ol|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function assertRichTextSafe(value, label = '内容') {
  const normalized = typeof value === 'string' ? value : ''
  if (!normalized) return normalized
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new AdminError('VALIDATION_FAILED', `${label}包含不允许的标记`)
    }
  }
  return normalized
}

module.exports = {
  richTextToPlainText,
  assertRichTextSafe,
}
