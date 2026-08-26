'use strict'

const { createProviderResponse, verifyProviderRequest } = require('../lib/contract')

function createDraftProvider(options) {
  return {
    async handle(event) {
      const request = verifyProviderRequest(event, {
        allowedAppIds: options.config.allowedAppIds,
        secret: options.config.secret,
      })
      return options.cache.run(request.operationKey, request.payloadDigest, async () => {
        const result = await options.upstream.invoke(request)
        return createProviderResponse(request, result, options.config.secret)
      })
    },
  }
}

module.exports = { createDraftProvider }
