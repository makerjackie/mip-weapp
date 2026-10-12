import type { VoiceRecordingResult } from '../src/modules/mip-ai/voice-recorder'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCapability: vi.fn(),
  createVoiceDraftFromRecording: vi.fn(),
  recorderStart: vi.fn(),
  recorderStop: vi.fn(),
  recorderCancel: vi.fn(),
  recorderRecording: vi.fn(),
  recorderElapsed: vi.fn(() => 0),
  recorderLastResult: vi.fn((): VoiceRecordingResult | null => null),
  createInnerAudioContext: vi.fn(),
  redirectTo: vi.fn(),
}))

vi.mock('../src/modules/mip-ai/client', () => ({
  mipAiModule: { getCapability: mocks.getCapability },
  mipVoiceNoteFlow: { createVoiceDraftFromRecording: mocks.createVoiceDraftFromRecording },
}))

vi.mock('../src/modules/mip-ai/voice-recorder', () => ({
  getSharedVoiceRecorder: () => ({
    start: mocks.recorderStart,
    stop: mocks.recorderStop,
    cancel: mocks.recorderCancel,
    recording: mocks.recorderRecording,
    elapsedMs: mocks.recorderElapsed,
    lastResult: mocks.recorderLastResult,
  }),
}))

let definition: Record<string, any>

beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  vi.stubGlobal('wx', {
    createInnerAudioContext: mocks.createInnerAudioContext,
    redirectTo: mocks.redirectTo,
  })
  await import('../src/packages/member/mip-ai/voice/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCapability.mockResolvedValue({ textDrafts: true, voiceDrafts: true, refinementDrafts: true })
  mocks.recorderRecording.mockReturnValue(true)
  mocks.recorderStart.mockResolvedValue(undefined)
  mocks.recorderElapsed.mockReturnValue(0)
})

function page() {
  const instance = Object.create(definition)
  instance.data = { ...definition.data }
  instance.setData = (value: Record<string, unknown>) => Object.assign(instance.data, value)
  return instance
}

function audioContext() {
  const handlers: Record<string, () => void> = {}
  const context = {
    src: '',
    play: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    onEnded: (handler: () => void) => { handlers.ended = handler },
    onStop: (handler: () => void) => { handlers.stop = handler },
    onError: (handler: () => void) => { handlers.error = handler },
    emit: (kind: 'ended' | 'stop' | 'error') => handlers[kind]?.(),
  }
  mocks.createInnerAudioContext.mockReturnValue(context)
  return context
}

async function loadedPage() {
  const instance = page()
  instance.onLoad({ purpose: 'SUPER_CASE' })
  await vi.waitFor(() => expect(instance.data.state).toBe('ready'))
  return instance
}

describe('AI voice note page', () => {
  it('recovers a take interrupted while the page was hidden into the review state', async () => {
    const instance = await loadedPage()
    await instance.startRecording()
    expect(instance.data.state).toBe('recording')
    expect(instance.recording).toBe(true)
    // 来电/切后台:onInterruptionBegin 已让 recorder 自动收尾,页面回到前台取走结果。
    mocks.recorderRecording.mockReturnValue(false)
    mocks.recorderLastResult.mockReturnValue({ filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 65_000 })
    instance.onHide()
    instance.onShow()
    expect(instance.data.state).toBe('review')
    expect(instance.data.durationText).toBe('01:05')
    expect(instance.recording).toBe(false)
    expect(instance.recordingResult).toMatchObject({ durationMs: 65_000 })
  })

  it('falls back to the ready state when the interrupted take produced no result', async () => {
    const instance = await loadedPage()
    await instance.startRecording()
    mocks.recorderRecording.mockReturnValue(false)
    mocks.recorderLastResult.mockReturnValue(null)
    instance.onShow()
    expect(instance.data.state).toBe('ready')
    expect(instance.data.message).toContain('内容为空')
  })

  it('plays the finished take back and stops on the second tap', async () => {
    const instance = await loadedPage()
    instance.data.state = 'review'
    instance.recordingResult = { filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 1000 }
    const context = audioContext()
    instance.togglePlayback()
    expect(instance.data.playing).toBe(true)
    expect(context.src).toBe('wxfile://usr/mip-ai-voice.mp3')
    expect(context.play).toHaveBeenCalledTimes(1)
    instance.togglePlayback()
    expect(instance.data.playing).toBe(false)
    expect(context.stop).toHaveBeenCalledTimes(1)
    expect(context.destroy).toHaveBeenCalledTimes(1)
  })

  it('clears the playing flag when playback ends by itself', async () => {
    const instance = await loadedPage()
    instance.data.state = 'review'
    instance.recordingResult = { filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 1000 }
    const context = audioContext()
    instance.togglePlayback()
    context.emit('ended')
    expect(instance.data.playing).toBe(false)
  })

  it('stops playback before deleting or confirming the take', async () => {
    const instance = await loadedPage()
    instance.data.state = 'review'
    instance.recordingResult = { filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 1000 }
    const context = audioContext()
    instance.togglePlayback()
    instance.askDeleteRecording()
    instance.confirmDeleteRecording()
    expect(instance.data.state).toBe('ready')
    expect(instance.data.playing).toBe(false)
    expect(context.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.recorderCancel).toHaveBeenCalledTimes(1)
  })

  it('redirects to the target editor with the draft id after a successful submission', async () => {
    const instance = await loadedPage()
    instance.data.state = 'review'
    instance.recordingResult = { filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 1000 }
    mocks.createVoiceDraftFromRecording.mockResolvedValue({ id: '20000000-0000-4000-8000-000000000001' })
    await instance.confirmRecording()
    expect(instance.data.state).toBe('processing')
    await vi.waitFor(() => {
      expect(mocks.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
        url: '/packages/member/mip-cases/editor/index?aiDraftId=20000000-0000-4000-8000-000000000001',
      }))
    })
  })

  it('cancels an in-flight recording when the page unloads', async () => {
    const instance = await loadedPage()
    await instance.startRecording()
    instance.onUnload()
    expect(instance.recording).toBe(false)
    expect(mocks.recorderCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores a second finish tap while the first stop is still in flight (BUG-07.1)', async () => {
    const instance = await loadedPage()
    await instance.startRecording()
    // 模拟 stop() 回包慢(平台 onStop 异步):两次 tap 都发生在 resolve 之前。
    let resolveStop!: (value: VoiceRecordingResult) => void
    mocks.recorderStop.mockImplementation(() => new Promise<VoiceRecordingResult>((resolve) => {
      resolveStop = resolve
    }))
    const first = instance.finishRecording()
    const second = instance.finishRecording()
    // 第二次 tap 必须被 in-flight 锁吞掉:只允许一次 recorder.stop,
    // 否则第二次 stop 被 recorder 同步 reject,把「当前没有进行中的录音」写进确认页。
    expect(mocks.recorderStop).toHaveBeenCalledTimes(1)
    resolveStop({ filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 5000 })
    await Promise.all([first, second])
    expect(instance.data.state).toBe('review')
    expect(instance.data.durationText).toBe('00:05')
    // 成功路径显式清空 message:确认页不得残留错误文案。
    expect(instance.data.message).toBe('')
    expect(instance.recording).toBe(false)
    expect(instance.finishingRecording).toBe(false)
  })

  it('keeps the delete entry inert while the AI flow is processing (BUG-07.2)', async () => {
    const instance = await loadedPage()
    instance.data.state = 'review'
    instance.recordingResult = { filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 1000 }
    mocks.createVoiceDraftFromRecording.mockImplementation(() => new Promise(() => {}))
    void instance.confirmRecording()
    expect(instance.data.state).toBe('processing')
    // processing 态点「删除重录」:不弹删除确认弹窗。
    instance.askDeleteRecording()
    expect(instance.data.deleteDialogOpen).toBe(false)
    // 极端时序:弹窗已开时流程切入 processing,确认删除也只关弹窗、不丢弃录音。
    instance.setData({ deleteDialogOpen: true })
    instance.confirmDeleteRecording()
    expect(instance.data.deleteDialogOpen).toBe(false)
    expect(instance.data.state).toBe('processing')
    expect(mocks.recorderCancel).not.toHaveBeenCalled()
  })

  it('discards the draft instead of redirecting when the page left processing (BUG-07.2)', async () => {
    const instance = await loadedPage()
    instance.data.state = 'review'
    instance.recordingResult = { filePath: 'wxfile://usr/mip-ai-voice.mp3', durationMs: 1000 }
    let resolveDraft!: (draft: { id: string }) => void
    mocks.createVoiceDraftFromRecording.mockImplementation(() => new Promise((resolve) => {
      resolveDraft = resolve
    }))
    const pending = instance.confirmRecording()
    expect(instance.data.state).toBe('processing')
    // 等待期间页面状态被复位(如用户已删除重录):草稿返回时不得再强制跳编辑器。
    instance.data.state = 'ready'
    resolveDraft({ id: '20000000-0000-4000-8000-000000000002' })
    await pending
    expect(mocks.redirectTo).not.toHaveBeenCalled()
  })

  it('restarts the elapsed timer on show while the recording is still alive (BUG-07.3)', async () => {
    const instance = await loadedPage()
    vi.useFakeTimers()
    try {
      await instance.startRecording()
      mocks.recorderElapsed.mockReturnValue(3000)
      // onHide 停表;回到前台时录音仍存活(recorder.recording()=true),
      // 计时器必须重启,否则 elapsedText 冻结、页面与 recorder 失联。
      instance.onHide()
      instance.onShow()
      vi.advanceTimersByTime(250)
      expect(instance.data.elapsedText).toBe('00:03')
      expect(instance.data.state).toBe('recording')
      instance.stopElapsedTimer()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
