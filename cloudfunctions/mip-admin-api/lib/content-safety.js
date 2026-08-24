'use strict'

const DEFAULT_CHUNK_CHARACTERS = 2_000
const CHUNK_OVERLAP_CHARACTERS = 128

async function checkCompleteContentSafety(draft, caller, checker, options = {}) {
  const content = [
    draft.title,
    draft.summary,
    draft.body,
    draft.bodyText,
    draft.description,
    draft.notices,
  ]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n')
  if (!content || typeof checker !== 'function') return 'ERROR'
  const chunks = chunkText(content, options.chunkCharacters)
  try {
    for (const chunk of chunks) {
      const result = await checker({ content: chunk, version: 2, scene: 2, openid: caller.openId })
      const errorCode = Number(result?.errCode ?? result?.errcode)
      if (errorCode !== 0 || result?.result?.suggest !== 'pass') return 'REJECTED'
    }
    return 'PASSED'
  }
  catch {
    return 'ERROR'
  }
}

function chunkText(value, requestedSize = DEFAULT_CHUNK_CHARACTERS) {
  const size = Number(requestedSize || DEFAULT_CHUNK_CHARACTERS)
  if (!Number.isInteger(size) || size < 100 || size > DEFAULT_CHUNK_CHARACTERS) {
    throw new Error('CONTENT_SAFETY_CONFIG_INVALID')
  }
  const characters = Array.from(String(value || ''))
  const chunks = []
  const advance = size - CHUNK_OVERLAP_CHARACTERS
  for (let index = 0; index < characters.length; index += advance) {
    chunks.push(characters.slice(index, index + size).join(''))
    if (index + size >= characters.length) break
  }
  return chunks
}

module.exports = {
  checkCompleteContentSafety,
  chunkText,
}
