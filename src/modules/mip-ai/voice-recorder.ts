// AI 语音填写录音控制器。
// RecorderManager 单次 duration 上限 600000ms(10 分钟),要支持 15 分钟录音需要
// 平台自动分段后由这里续录,并把分段 mp3 帧流按字节拼接成一份文件;
// 16kHz/mono/48kbps 下 15 分钟 ≈ 5.4MB,低于服务端 6MB 上限。
// wx.getRecorderManager() 是全局单例,事件回调按实例注册会跨页面堆叠,
// 因此运行时共用 getSharedVoiceRecorder() 持有的唯一实例。

export interface VoiceRecordingResult {
  filePath: string
  durationMs: number
  // 帧累积路径直接携带完整字节;开发者工具无帧流时缺省,由调用方读文件获得。
  bytes?: Uint8Array
}

interface RecorderManagerLike {
  start: (options: Record<string, unknown>) => void
  stop: () => void
  onStart: (handler: (result?: { errMsg?: string }) => void) => void
  onStop: (handler: (result: { tempFilePath?: string, duration?: number, fileSize?: number }) => void) => void
  onError: (handler: (error: { errMsg?: string }) => void) => void
  onFrameRecorded: (handler: (result: { frameBuffer: ArrayBuffer, isLastFrame: boolean }) => void) => void
  onInterruptionBegin: (handler: () => void) => void
}

interface FileSystemManagerLike {
  writeFile: (options: {
    filePath: string
    data: ArrayBuffer
    success?: () => void
    fail?: (error: { errMsg?: string }) => void
  }) => void
}

export interface VoiceRecorderDeps {
  manager?: RecorderManagerLike
  fileSystem?: FileSystemManagerLike
  now?: () => number
  maximumDurationMs?: number
  maximumBytes?: number
  userFilePath?: string
}

export interface VoiceRecorder {
  start: () => Promise<void>
  stop: () => Promise<VoiceRecordingResult>
  cancel: () => void
  recording: () => boolean
  elapsedMs: () => number
  // 到达 15 分钟上限自动结束时没有人 await stop(),结果落在这里供页面轮询取走。
  lastResult: () => VoiceRecordingResult | null
}

export const voiceRecordingLimits = {
  maximumDurationMs: 15 * 60 * 1000,
  // 48kbps × 900s ÷ 8 ≈ 5.4MB,给容器/容差错位留余量,低于服务端 6MB 契约上限。
  maximumBytes: 5_500_000,
  // 微信平台单段录音上限。
  segmentDurationMs: 600_000,
} as const

function startOptions(): Record<string, unknown> {
  return {
    duration: voiceRecordingLimits.segmentDurationMs,
    sampleRate: 16_000,
    numberOfChannels: 1,
    format: 'mp3',
    encodeBitRate: 48_000,
    frameSize: 4,
  }
}

export function createVoiceRecorder(deps: VoiceRecorderDeps = {}): VoiceRecorder {
  const manager = deps.manager || wx.getRecorderManager()
  const fileSystem = deps.fileSystem || wx.getFileSystemManager()
  const now = deps.now || (() => Date.now())
  const maximumDurationMs = deps.maximumDurationMs ?? voiceRecordingLimits.maximumDurationMs
  const maximumBytes = deps.maximumBytes ?? voiceRecordingLimits.maximumBytes
  const userFilePath = deps.userFilePath || `${wx.env.USER_DATA_PATH}/mip-ai-voice.mp3`

  let state: 'idle' | 'recording' | 'finalizing' = 'idle'
  let segments: Uint8Array[] = []
  let frameBytes = 0
  let startedAt = 0
  let accumulatedDurationMs = 0
  let lastTempFilePath = ''
  let lastFinished: VoiceRecordingResult | null = null
  let startSettle: { resolve: () => void, reject: (error: Error) => void } | null = null
  let stopSettle: { resolve: (result: VoiceRecordingResult) => void, reject: (error: Error) => void } | null = null

  function settleStart(error?: Error) {
    const pending = startSettle
    startSettle = null
    if (!pending) {
      return
    }
    error ? pending.reject(error) : pending.resolve()
  }

  function settleStop(error?: Error, result?: VoiceRecordingResult) {
    const pending = stopSettle
    stopSettle = null
    if (!pending) {
      return
    }
    error ? pending.reject(error) : pending.resolve(result as VoiceRecordingResult)
  }

  function reset() {
    segments = []
    frameBytes = 0
    accumulatedDurationMs = 0
    lastTempFilePath = ''
    lastFinished = null
  }

  function finish(result: VoiceRecordingResult | null, error?: Error) {
    state = 'idle'
    if (result) {
      lastFinished = result
    }
    settleStop(error, result ?? undefined)
  }

  function fail(error: Error) {
    finish(null, error)
    settleStart(error)
  }

  function finalize() {
    const finishedAt = accumulatedDurationMs || Math.min(now() - startedAt, maximumDurationMs)
    if (!segments.length) {
      // 开发者工具可能不触发 onFrameRecorded:退回平台生成的临时文件,由调用方读文件。
      if (!lastTempFilePath) {
        finish(null, new Error('录音内容为空，请重新录制'))
        return
      }
      finish({ filePath: lastTempFilePath, durationMs: finishedAt })
      return
    }
    const merged = new Uint8Array(frameBytes)
    let offset = 0
    for (const segment of segments) {
      merged.set(segment, offset)
      offset += segment.length
    }
    fileSystem.writeFile({
      filePath: userFilePath,
      data: merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.length) as ArrayBuffer,
      success: () => finish({ filePath: userFilePath, durationMs: finishedAt, bytes: merged }),
      fail: error => fail(new Error(error?.errMsg || '录音文件保存失败')),
    })
  }

  function handleStop(result: { tempFilePath?: string, duration?: number }) {
    accumulatedDurationMs += Number(result.duration) || 0
    if (result.tempFilePath) {
      lastTempFilePath = result.tempFilePath
    }
    if (state === 'recording') {
      const moreTime = now() - startedAt < maximumDurationMs
      const moreBytes = frameBytes < maximumBytes
      if (moreTime && moreBytes && segments.length) {
        // 平台 10 分钟自动分段:立即续录,帧流继续追加到同一份内容里。
        // 续录启动失败时按自动收尾处理,已录内容不丢。
        try {
          manager.start(startOptions())
        }
        catch {
          state = 'finalizing'
          finalize()
        }
        return
      }
      state = 'finalizing'
      finalize()
      return
    }
    if (state === 'finalizing') {
      finalize()
    }
  }

  manager.onStart(() => {
    state = 'recording'
    settleStart()
  })
  manager.onStop(handleStop)
  manager.onError(error => fail(new Error(error?.errMsg || '录音失败，请重试')))
  manager.onFrameRecorded((result) => {
    if (state !== 'recording') {
      return
    }
    segments.push(new Uint8Array(result.frameBuffer))
    frameBytes += result.frameBuffer.byteLength
    if (frameBytes >= maximumBytes || now() - startedAt >= maximumDurationMs) {
      state = 'finalizing'
      manager.stop()
    }
  })
  manager.onInterruptionBegin(() => {
    // 来电等系统打断:保留已录内容并结束本次录音。
    if (state === 'recording') {
      state = 'finalizing'
      manager.stop()
    }
  })

  return {
    start() {
      if (state !== 'idle') {
        return Promise.reject(new Error('正在录音中'))
      }
      reset()
      startedAt = now()
      return new Promise<void>((resolve, reject) => {
        startSettle = { resolve, reject }
        try {
          manager.start(startOptions())
        }
        catch (error) {
          fail(error instanceof Error ? error : new Error('录音启动失败'))
        }
      })
    },
    stop() {
      if (state !== 'recording') {
        return Promise.reject(new Error('当前没有进行中的录音'))
      }
      state = 'finalizing'
      return new Promise<VoiceRecordingResult>((resolve, reject) => {
        stopSettle = { resolve, reject }
        try {
          manager.stop()
        }
        catch (error) {
          finish(null, error instanceof Error ? error : new Error('录音结束失败，请重试'))
        }
      })
    },
    cancel() {
      if (state === 'idle') {
        return
      }
      state = 'idle'
      reset()
      settleStart(new Error('录音已取消'))
      settleStop(new Error('录音已取消'))
      try {
        manager.stop()
      }
      catch {}
    },
    recording: () => state === 'recording',
    elapsedMs: () => (state === 'idle' ? 0 : Math.min(now() - startedAt, maximumDurationMs)),
    lastResult: () => lastFinished,
  }
}

let sharedRecorder: VoiceRecorder | null = null

export function getSharedVoiceRecorder(): VoiceRecorder {
  if (!sharedRecorder) {
    sharedRecorder = createVoiceRecorder()
  }
  return sharedRecorder
}
