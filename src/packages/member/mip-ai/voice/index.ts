import type { AiDraftPurpose } from '../../../../modules/mip-ai/types'
import type { VoiceRecordingResult } from '../../../../modules/mip-ai/voice-recorder'
import { mipAiModule, mipVoiceNoteFlow } from '../../../../modules/mip-ai/client'
import { getSharedVoiceRecorder } from '../../../../modules/mip-ai/voice-recorder'

const purposeTargets: Record<string, { path: string, label: string, hint: string }> = {
  SUPER_CASE: {
    path: '/packages/member/mip-cases/editor/index',
    label: '超级案例',
    hint: '说出项目名称、你的职责、过程和结果，AI 会整理成案例草稿。',
  },
  COOPERATION_CARD: {
    path: '/packages/member/mip-cooperation/editor/index',
    label: '合作卡',
    hint: '说出你的角色、想找什么样的合作方，AI 会整理成合作卡草稿。',
  },
}

type PageState = 'loading' | 'ready' | 'recording' | 'review' | 'processing' | 'error'

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

Page({
  data: {
    state: 'loading' as PageState,
    purpose: 'SUPER_CASE' as AiDraftPurpose,
    purposeLabel: '',
    hint: '',
    elapsedText: '00:00',
    maximumText: '15:00',
    durationText: '00:00',
    message: '',
    deleteDialogOpen: false,
    playing: false,
  },

  recording: false,
  elapsedTimer: undefined as ReturnType<typeof setInterval> | undefined,
  recordingResult: null as VoiceRecordingResult | null,
  playback: undefined as WechatMiniprogram.InnerAudioContext | undefined,

  onLoad(options: Record<string, string | undefined>) {
    const target = purposeTargets[String(options.purpose || '')]
    if (!target) {
      this.setData({
        state: 'error',
        message: 'AI 语音填写仅支持超级案例和合作卡',
      })
      return
    }
    this.setData({
      purpose: String(options.purpose) as AiDraftPurpose,
      purposeLabel: target.label,
      hint: target.hint,
    })
    void this.initialize()
  },

  onShow() {
    // 录音中被系统打断(来电/切后台)时 recorder 会自动收尾;回到前台取走结果进确认态,
    // 否则页面会停在录音态,用户一按「录完」就把整段录音丢掉。
    if (this.recording && !getSharedVoiceRecorder().recording()) {
      this.adoptFinishedRecorder()
    }
  },

  onHide() {
    // 离开页面(含跳转编辑器)时停止计时器与回听;录音由确认流程或 onUnload 收尾。
    this.stopElapsedTimer()
    this.stopPlayback()
  },

  onUnload() {
    this.stopElapsedTimer()
    this.stopPlayback()
    if (this.recording) {
      this.recording = false
      getSharedVoiceRecorder().cancel()
    }
  },

  async initialize() {
    this.setData({ state: 'loading', message: '' })
    try {
      const capability = await mipAiModule.getCapability()
      if (!capability.voiceDrafts) {
        this.setData({ state: 'error', message: 'AI 语音填写暂未开放，请稍后再试' })
        return
      }
      this.setData({ state: 'ready' })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : 'AI 服务暂时不可用',
      })
    }
  },

  async startRecording() {
    if (this.data.state !== 'ready' && this.data.state !== 'review') {
      return
    }
    const recorder = getSharedVoiceRecorder()
    this.stopPlayback()
    try {
      this.setData({ state: 'recording', elapsedText: '00:00', message: '' })
      await recorder.start()
      this.recording = true
      this.startElapsedTimer()
    }
    catch (error) {
      this.recording = false
      this.setData({
        state: 'ready',
        message: error instanceof Error ? error.message : '录音启动失败，请重试',
      })
    }
  },

  startElapsedTimer() {
    this.stopElapsedTimer()
    this.elapsedTimer = setInterval(() => {
      const recorder = getSharedVoiceRecorder()
      if (this.recording && !recorder.recording()) {
        // 到达 15 分钟上限或系统打断自动结束:取走结果进入确认。
        this.adoptFinishedRecorder()
        return
      }
      this.setData({ elapsedText: formatDuration(recorder.elapsedMs()) })
    }, 250)
  },

  // recorder 已自动收尾(15 分钟上限/系统打断):把已录内容接进确认态。
  adoptFinishedRecorder() {
    this.recording = false
    this.stopElapsedTimer()
    const result = getSharedVoiceRecorder().lastResult()
    if (result) {
      this.recordingResult = result
      this.setData({ state: 'review', durationText: formatDuration(result.durationMs) })
    }
    else {
      this.setData({ state: 'ready', message: '录音已结束，但内容为空，请重新录制' })
    }
  },

  stopElapsedTimer() {
    if (this.elapsedTimer !== undefined) {
      clearInterval(this.elapsedTimer)
      this.elapsedTimer = undefined
    }
  },

  async finishRecording() {
    if (!this.recording) {
      return
    }
    const recorder = getSharedVoiceRecorder()
    this.stopElapsedTimer()
    try {
      const result = await recorder.stop()
      this.recording = false
      this.recordingResult = result
      this.setData({ state: 'review', durationText: formatDuration(result.durationMs) })
    }
    catch (error) {
      this.recording = false
      this.setData({
        state: 'ready',
        message: error instanceof Error ? error.message : '录音结束失败，请重试',
      })
    }
  },

  // 回听(设计 2172:42168 录完态):点击圆盘播放/停止当前这段录音。
  togglePlayback() {
    if (this.data.state !== 'review' || !this.recordingResult) {
      return
    }
    if (this.data.playing) {
      this.stopPlayback()
      return
    }
    this.stopPlayback()
    const audio = wx.createInnerAudioContext()
    audio.src = this.recordingResult.filePath
    audio.onEnded(() => this.setData({ playing: false }))
    audio.onStop(() => this.setData({ playing: false }))
    audio.onError(() => this.setData({ playing: false, message: '回听失败，可直接确认使用或删除重录' }))
    this.playback = audio
    this.setData({ playing: true, message: '' })
    audio.play()
  },

  stopPlayback() {
    const audio = this.playback
    this.playback = undefined
    if (audio) {
      try {
        audio.stop()
        audio.destroy()
      }
      catch {}
    }
    if (this.data.playing) {
      this.setData({ playing: false })
    }
  },

  askDeleteRecording() {
    this.setData({ deleteDialogOpen: true })
  },

  cancelDeleteRecording() {
    this.setData({ deleteDialogOpen: false })
  },

  confirmDeleteRecording() {
    // 删除提示(设计 2172:42168 删除态):丢弃当前录音回到开始态;文件在下次录制时覆盖。
    this.setData({ deleteDialogOpen: false })
    this.stopPlayback()
    getSharedVoiceRecorder().cancel()
    this.recordingResult = null
    this.setData({ state: 'ready', message: '' })
  },

  async confirmRecording() {
    if (this.data.state !== 'review' || !this.recordingResult) {
      return
    }
    const target = purposeTargets[this.data.purpose]
    const result = this.recordingResult
    this.stopPlayback()
    this.setData({ state: 'processing', message: '' })
    try {
      const draft = await mipVoiceNoteFlow.createVoiceDraftFromRecording(this.data.purpose, result)
      wx.redirectTo({
        url: `${target.path}?aiDraftId=${draft.id}`,
        fail: () => this.setData({ state: 'review', message: '页面跳转失败，请重试' }),
      })
    }
    catch (error) {
      this.setData({
        state: 'review',
        message: error instanceof Error ? error.message : 'AI 整理失败，请重试',
      })
    }
  },
})
