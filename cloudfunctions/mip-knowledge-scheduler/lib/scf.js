'use strict'

function createScfClient(options) {
  const tencentcloud = require('tencentcloud-sdk-nodejs-scf')
  const ScfClient = tencentcloud.scf.v20180416.Client
  return new ScfClient({
    credential: options.credentials,
    region: options.region,
    profile: {
      httpProfile: {
        endpoint: 'scf.tencentcloudapi.com',
        reqTimeout: 50,
      },
    },
  })
}

module.exports = { createScfClient }
