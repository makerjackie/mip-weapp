'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createAvatarProvider } = require('./domain/provider')
const { readConfig } = require('./lib/config')
const { createImageLoader } = require('./lib/image')
const { createHttpsJsonClient } = require('./lib/network')
const { createOperationCache } = require('./lib/operation-cache')
const { createUpstreamAdapter } = require('./lib/upstream')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

let defaultRuntime

function createRuntime(options = {}) {
  const config = options.config || readConfig()
  const http = options.http || createHttpsJsonClient()
  const upstream = options.upstream || createUpstreamAdapter({
    config,
    http,
    imageLoader: options.imageLoader || createImageLoader(cloud),
  })
  return {
    config,
    http,
    provider: createAvatarProvider({
      cache: options.cache || createOperationCache(),
      config,
      upstream,
    }),
    upstream,
  }
}

exports.main = createHandler(() => defaultRuntime || (defaultRuntime = createRuntime()))

exports._test = {
  createRuntime,
  createHandler,
  resetRuntime() { defaultRuntime = undefined },
}
