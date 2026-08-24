interface RecordedVoice {
  audioBase64: string
  contentType: 'audio/mpeg'
  durationMs: number
}

export interface MipVoiceRecorder {
  start: () => void
  stop: () => void
  result: Promise<RecordedVoice>
}

function readBase64(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success(result) {
        if (typeof result.data === 'string') {
          resolve(result.data)
          return
        }
        reject(new Error('录音读取失败'))
      },
      fail: reject,
    })
  })
}

export function createMipVoiceRecorder(): MipVoiceRecorder {
  const recorder = wx.getRecorderManager()
  let settleResolve: (value: RecordedVoice) => void
  let settleReject: (reason?: unknown) => void
  const result = new Promise<RecordedVoice>((resolve, reject) => {
    settleResolve = resolve
    settleReject = reject
  })
  recorder.onStop((event) => {
    void readBase64(event.tempFilePath).then(audioBase64 => settleResolve({
      audioBase64,
      contentType: 'audio/mpeg',
      durationMs: Number(event.duration || 0),
    }), settleReject)
  })
  recorder.onError(error => settleReject(new Error(error.errMsg || '录音失败')))
  return {
    result,
    start() {
      recorder.start({
        duration: 60_000,
        sampleRate: 16_000,
        numberOfChannels: 1,
        encodeBitRate: 48_000,
        format: 'mp3',
      })
    },
    stop() {
      recorder.stop()
    },
  }
}
