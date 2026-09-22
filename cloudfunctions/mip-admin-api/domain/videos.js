'use strict'

const { AdminError } = require('./validation')

function notImplemented(message) {
  return async () => {
    throw new AdminError('NOT_IMPLEMENTED', message, true)
  }
}

function createVideos() {
  return {
    listVideos: async () => ({ items: [], cursor: null }),
    saveVideo: notImplemented('保存视频功能尚未实现'),
    changeVideoStatus: notImplemented('更改视频状态功能尚未实现'),
  }
}

module.exports = { createVideos }
