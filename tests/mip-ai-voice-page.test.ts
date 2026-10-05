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
})
