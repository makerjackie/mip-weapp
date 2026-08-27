interface RecordedVoice {
  audioBase64: string
  contentType: 'audio/mpeg'
  durationMs: number
}

interface RecorderSession {
  resolve: (value: RecordedVoice) => void
  reject: (reason?: unknown) => void
  state: 'idle' | 'recording' | 'resolving' | 'settled'
}

export interface MipVoiceRecorder {
  start: () => void
  stop: () => void
  result: Promise<RecordedVoice>
}

let recorderManager: WechatMiniprogram.RecorderManager | undefined
let activeSession: RecorderSession | undefined

function settleSession(session: RecorderSession, result?: RecordedVoice, error?: unknown) {
  if (session.state === 'settled') {
    return
  }
  session.state = 'settled'
  if (activeSession === session) {
    activeSession = undefined
  }
  if (error !== undefined) {
    session.reject(error)
  }
  else if (result) {
    session.resolve(result)
  }
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

function getRecorderManager() {
  if (!recorderManager) {
    recorderManager = wx.getRecorderManager()
    recorderManager.onStop((event) => {
      const session = activeSession
      if (!session || session.state !== 'recording') {
        return
      }
      session.state = 'resolving'
      void readBase64(event.tempFilePath).then(audioBase64 => settleSession(session, {
        audioBase64,
        contentType: 'audio/mpeg',
        durationMs: Number(event.duration || 0),
      }), error => settleSession(session, undefined, error))
    })
    recorderManager.onError((error) => {
      const session = activeSession
      if (session && (session.state === 'recording' || session.state === 'resolving')) {
        settleSession(session, undefined, new Error(error.errMsg || '录音失败'))
      }
    })
  }
  return recorderManager
}

export function createMipVoiceRecorder(): MipVoiceRecorder {
  const recorder = getRecorderManager()
  let session: RecorderSession | undefined
  const result = new Promise<RecordedVoice>((resolve, reject) => {
    session = { resolve, reject, state: 'idle' }
  })
  return {
    result,
    start() {
      if (!session || session.state !== 'idle') {
        throw new Error('录音已开始')
      }
      if (activeSession) {
        const error = new Error('录音正在进行')
        settleSession(session, undefined, error)
        throw error
      }
      activeSession = session
      session.state = 'recording'
      try {
        recorder.start({
          duration: 60_000,
          sampleRate: 16_000,
          numberOfChannels: 1,
          encodeBitRate: 48_000,
          format: 'mp3',
        })
      }
      catch (error) {
        settleSession(session, undefined, error)
        throw error
      }
    },
    stop() {
      if (session?.state === 'recording' && activeSession === session) {
        recorder.stop()
      }
    },
  }
}
