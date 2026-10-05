import type { VoiceRecorderDeps } from '../src/modules/mip-ai/voice-recorder'
import { describe, expect, it, vi } from 'vitest'
import { createVoiceRecorder, voiceRecordingLimits } from '../src/modules/mip-ai/voice-recorder'

interface Harness {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  emitStart: () => void
  emitStop: (result?: { tempFilePath?: string, duration?: number }) => void
  emitFrame: (bytes: number) => void
  emitError: (message: string) => void
}

function createManagerHarness(): { manager: VoiceRecorderDeps['manager'], harness: Harness } {
  const handlers: Record<string, (result?: unknown) => void> = {}
  const manager = {
    start: vi.fn(),
    stop: vi.fn(),
    onStart: (handler: () => void) => { handlers.start = handler },
    onStop: (handler: (result: { tempFilePath?: string, duration?: number }) => void) => { handlers.stop = handler },
    onError: (handler: (error: { errMsg?: string }) => void) => { handlers.error = handler },
    onFrameRecorded: (handler: (result: { frameBuffer: ArrayBuffer, isLastFrame: boolean }) => void) => { handlers.frame = handler },
    onInterruptionBegin: (handler: () => void) => { handlers.interruption = handler },
  } as unknown as VoiceRecorderDeps['manager']
  const harness: Harness = {
    start: manager.start as ReturnType<typeof vi.fn>,
    stop: manager.stop as ReturnType<typeof vi.fn>,
    emitStart: () => handlers.start?.(),
    emitStop: (result) => {
      handlers.stop?.(result ?? { tempFilePath: 'wxfile://tmp/rec.mp3', duration: 1000 })
    },
    emitFrame: (bytes) => {
      handlers.frame?.({ frameBuffer: new ArrayBuffer(bytes), isLastFrame: false })
    },
    emitError: (message) => {
      handlers.error?.({ errMsg: message })
    },
  }
  return { manager, harness }
}

function writeFileHarness() {
  const writes: Array<{ filePath: string, data: ArrayBuffer }> = []
  const fileSystem = {
    writeFile: (options: { filePath: string, data: ArrayBuffer, success?: () => void }) => {
      writes.push({ filePath: options.filePath, data: options.data })
      options.success?.()
    },
  }
  return { fileSystem, writes }
}

describe('AI voice recorder', () => {
  it('merges frame streams into one user file and reports its bytes', async () => {
    const { manager, harness } = createManagerHarness()
    const { fileSystem, writes } = writeFileHarness()
    let clock = 0
    const recorder = createVoiceRecorder({
      manager,
      fileSystem,
      now: () => clock,
      userFilePath: 'wxfile://usr/mip-ai-voice.mp3',
    })
    const started = recorder.start()
    harness.emitStart()
    await started
    harness.emitFrame(100)
    harness.emitFrame(50)
    clock = 2000
    const stopped = recorder.stop()
    harness.emitStop({ duration: 1800 })
    const result = await stopped
    expect(writes).toHaveLength(1)
    expect(writes[0].filePath).toBe('wxfile://usr/mip-ai-voice.mp3')
    expect(writes[0].data.byteLength).toBe(150)
    expect(result).toMatchObject({ filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 1800 })
    expect(result.bytes && result.bytes.length).toBe(150)
    expect(recorder.recording()).toBe(false)
    expect(recorder.lastResult()).toBe(result)
  })

  it('restarts after the platform segment cap and keeps recording until the take limit', async () => {
    const { manager, harness } = createManagerHarness()
    const { fileSystem } = writeFileHarness()
    let clock = 0
    const recorder = createVoiceRecorder({
      manager,
      fileSystem,
      now: () => clock,
      maximumDurationMs: voiceRecordingLimits.maximumDurationMs,
      userFilePath: 'wxfile://usr/mip-ai-voice.mp3',
    })
    const started = recorder.start()
    harness.emitStart()
    await started
    harness.emitFrame(10)
    // 平台 10 分钟自动分段:recorder 续录而不是结束本次录音。
    clock = 600_000
    harness.emitStop({ tempFilePath: 'wxfile://tmp/seg1.mp3', duration: 600_000 })
    expect(harness.start).toHaveBeenCalledTimes(2)
    harness.emitFrame(20)
    // 到达 15 分钟上限:帧回调触发自动收尾。
    clock = 900_000
    harness.emitFrame(5)
    expect(harness.stop).toHaveBeenCalledTimes(1)
    harness.emitStop({ tempFilePath: 'wxfile://tmp/seg2.mp3', duration: 300_000 })
    await vi.waitFor(() => expect(recorder.lastResult()).not.toBeNull())
    expect(recorder.lastResult()).toMatchObject({ filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 900_000 })
    expect(recorder.lastResult()?.bytes?.length).toBe(35)
  })

  it('falls back to the platform temp file when frame callbacks never fire', async () => {
    const { manager, harness } = createManagerHarness()
    const { fileSystem, writes } = writeFileHarness()
    const recorder = createVoiceRecorder({ manager, fileSystem, now: () => 0, userFilePath: 'wxfile://usr/mip-ai-voice.mp3' })
    const started = recorder.start()
    harness.emitStart()
    await started
    const stopped = recorder.stop()
    harness.emitStop({ tempFilePath: 'wxfile://tmp/devtools.mp3', duration: 5000 })
    const result = await stopped
    expect(writes).toHaveLength(0)
    expect(result).toEqual({ filePath: 'wxfile://tmp/devtools.mp3', durationMs: 5000 })
    expect(result.bytes).toBeUndefined()
  })

  it('cancels a take without producing a result', async () => {
    const { manager, harness } = createManagerHarness()
    const { fileSystem } = writeFileHarness()
    const recorder = createVoiceRecorder({ manager, fileSystem, now: () => 0, userFilePath: 'wxfile://usr/mip-ai-voice.mp3' })
    const started = recorder.start()
    harness.emitStart()
    await started
    harness.emitFrame(10)
    recorder.cancel()
    harness.emitStop({ tempFilePath: 'wxfile://tmp/x.mp3', duration: 100 })
    expect(recorder.lastResult()).toBeNull()
    expect(recorder.recording()).toBe(false)
    // 取消后可以重新开始。
    const restarted = recorder.start()
    harness.emitStart()
    await expect(restarted).resolves.toBeUndefined()
  })

  it('surfaces recorder errors to both pending start and stop', async () => {
    const { manager, harness } = createManagerHarness()
    const { fileSystem } = writeFileHarness()
    const recorder = createVoiceRecorder({ manager, fileSystem, now: () => 0, userFilePath: 'wxfile://usr/mip-ai-voice.mp3' })
    const started = recorder.start()
    harness.emitError('operateRecorder:fail auth deny')
    await expect(started).rejects.toThrow('operateRecorder:fail auth deny')
    expect(recorder.recording()).toBe(false)
  })

  it('finalizes the take with the frames so far when the continuation start fails', async () => {
    const { manager, harness } = createManagerHarness()
    const { fileSystem, writes } = writeFileHarness()
    let clock = 0
    const recorder = createVoiceRecorder({ manager, fileSystem, now: () => clock, userFilePath: 'wxfile://usr/mip-ai-voice.mp3' })
    const started = recorder.start()
    harness.emitStart()
    await started
    harness.emitFrame(30)
    // 平台 10 分钟分段后续录启动失败:已录内容按自动收尾落盘,不悬挂在录音态。
    clock = 600_000
    harness.start.mockImplementation(() => {
      throw new Error('RecorderManager:start:fail')
    })
    harness.emitStop({ tempFilePath: 'wxfile://tmp/seg1.mp3', duration: 600_000 })
    await vi.waitFor(() => expect(recorder.lastResult()).not.toBeNull())
    expect(writes).toHaveLength(1)
    expect(recorder.lastResult()).toMatchObject({ filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 600_000 })
    expect(recorder.lastResult()?.bytes?.length).toBe(30)
    expect(recorder.recording()).toBe(false)
  })

  it('rejects stop when manager.stop throws synchronously instead of hanging', async () => {
    const { manager, harness } = createManagerHarness()
    const { fileSystem } = writeFileHarness()
    const recorder = createVoiceRecorder({ manager, fileSystem, now: () => 0, userFilePath: 'wxfile://usr/mip-ai-voice.mp3' })
    const started = recorder.start()
    harness.emitStart()
    await started
    harness.emitFrame(10)
    harness.stop.mockImplementationOnce(() => {
      throw new Error('RecorderManager:stop:fail')
    })
    await expect(recorder.stop()).rejects.toThrow('RecorderManager:stop:fail')
    expect(recorder.recording()).toBe(false)
    // 失败后能重新开始,不卡死状态机。
    const restarted = recorder.start()
    harness.emitStart()
    await expect(restarted).resolves.toBeUndefined()
  })
})
