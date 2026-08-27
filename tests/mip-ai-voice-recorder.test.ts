import { describe, expect, it, vi } from 'vitest'
import { createMipVoiceRecorder } from '../src/modules/mip-ai/voice-recorder'

describe('MIP voice recorder', () => {
  it('registers global recorder listeners once and settles a stop only once', async () => {
    let stopListener: WechatMiniprogram.RecorderManagerOnStopCallback | undefined
    let errorListener: ((error: { errMsg?: string }) => void) | undefined
    let readSuccess: ((result: { data: string }) => void) | undefined
    const manager = {
      onStop: vi.fn((listener: WechatMiniprogram.RecorderManagerOnStopCallback) => { stopListener = listener }),
      onError: vi.fn((listener: (error: { errMsg?: string }) => void) => { errorListener = listener }),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as WechatMiniprogram.RecorderManager
    const readFile = vi.fn((options: { success?: (result: { data: string }) => void }) => {
      readSuccess = options.success
    })
    vi.stubGlobal('wx', {
      getRecorderManager: () => manager,
      getFileSystemManager: () => ({ readFile }),
    })

    const first = createMipVoiceRecorder()
    const idle = createMipVoiceRecorder()
    idle.stop()
    first.start()
    const idleResult = expect(idle.result).rejects.toThrow('录音正在进行')
    expect(() => idle.start()).toThrow('录音正在进行')
    await idleResult
    stopListener?.({ tempFilePath: '/tmp/voice.mp3', duration: 2_000 })
    stopListener?.({ tempFilePath: '/tmp/voice.mp3', duration: 2_000 })
    expect(readFile).toHaveBeenCalledTimes(1)
    readSuccess?.({ data: 'base64-audio' })
    await expect(first.result).resolves.toMatchObject({
      audioBase64: 'base64-audio',
      durationMs: 2_000,
    })

    const second = createMipVoiceRecorder()
    second.start()
    errorListener?.({ errMsg: '录音失败' })
    await expect(second.result).rejects.toThrow('录音失败')

    manager.start = vi.fn(() => {
      throw new Error('录音设备不可用')
    })
    const failing = createMipVoiceRecorder()
    const failingResult = expect(failing.result).rejects.toThrow('录音设备不可用')
    expect(() => failing.start()).toThrow('录音设备不可用')
    await failingResult

    manager.start = vi.fn()
    const recovered = createMipVoiceRecorder()
    recovered.start()
    errorListener?.({ errMsg: '录音已结束' })
    await expect(recovered.result).rejects.toThrow('录音已结束')
    expect(manager.onStop).toHaveBeenCalledTimes(1)
    expect(manager.onError).toHaveBeenCalledTimes(1)
  })
})
