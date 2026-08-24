'use strict'

function createMatchingProvider(cloud, options = {}) {
  const functionName = text(options.functionName)
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const configured = Boolean(
    functionName
    && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(functionName)
    && cloud
    && typeof cloud.callFunction === 'function',
  )

  return {
    configured,
    async rank(input) {
      if (!configured) { return { providerKey: 'LOCAL', candidates: input.candidates } }
      try {
        const response = await invokeWithTimeout(cloud.callFunction({
          name: functionName,
          data: {
            action: 'rankOpportunityMatches',
            contractVersion: 1,
            candidates: input.candidates.map(candidate => ({
              candidateRef: candidate.candidateRef,
              type: candidate.type,
              localScore: candidate.score,
              signals: candidate.explanation.map(item => ({ key: item.key, weight: item.weight })),
            })),
          },
        }), timeoutMs)
        const ranked = normalizeRanking(response?.result, input.candidates)
        return { providerKey: 'EXTERNAL', candidates: ranked }
      }
      catch (error) {
        return {
          providerKey: 'LOCAL',
          fallbackReason: safeCode(error?.message),
          candidates: input.candidates,
        }
      }
    },
  }
}

function normalizeRanking(value, localCandidates) {
  const envelope = value?.ok === true ? value.data : value
  const rows = Array.isArray(envelope?.candidates) ? envelope.candidates : null
  if (!rows || rows.length !== localCandidates.length) { throw new Error('MATCHING_PROVIDER_RESPONSE_INVALID') }
  const localByKey = new Map(localCandidates.map(item => [`${item.type}:${item.candidateRef}`, item]))
  const seen = new Set()
  const ranked = rows.map((row) => {
    const key = `${text(row?.type).toUpperCase()}:${text(row?.candidateRef)}`
    const local = localByKey.get(key)
    const externalScore = Number(row?.score)
    if (!local || seen.has(key) || !Number.isFinite(externalScore)
      || externalScore < 0 || externalScore > 100) {
      throw new Error('MATCHING_PROVIDER_RESPONSE_INVALID')
    }
    seen.add(key)
    return {
      ...local,
      score: Math.round(local.score * 0.7 + externalScore * 0.3),
    }
  })
  return ranked.sort(compareCandidate)
}

function compareCandidate(left, right) {
  return right.score - left.score || left.type.localeCompare(right.type) || left.id.localeCompare(right.id)
}

function boundedTimeout(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 500 && number <= 10_000 ? number : 3_000
}

async function invokeWithTimeout(invocation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      invocation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('MATCHING_PROVIDER_TIMEOUT')), timeoutMs)
        timer.unref?.()
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function safeCode(value) {
  const code = text(value)
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'MATCHING_PROVIDER_UNAVAILABLE'
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { createMatchingProvider, normalizeRanking }
