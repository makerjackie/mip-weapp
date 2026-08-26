'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createDraftProvider } = require('./domain/provider')
const { createAudioLoader } = require('./lib/audio')
const { readConfig } = require('./lib/config')
const { createHttpsJsonClient } = require('./lib/network')
const { createOperationCache } = require('./lib/operation-cache')
const { createUpstreamAdapter } = require('./lib/upstream')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

let defaultRuntime

function createRuntime(options = {}) {
  const config = options.config || readConfig()
  const http = options.http || createHttpsJsonClient()
  const upstream = options.upstream || createUpstreamAdapter({
    audioLoader: options.audioLoader || createAudioLoader(cloud),
    config,
    http,
  })
  return {
    config,
    http,
    provider: createDraftProvider({
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
