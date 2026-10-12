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
  // BUG-07.1:「录完」stop() 回包前的 in-flight 锁,拦住第二次 tap 触发第二次 stop。
  finishingRecording: false,
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
    if (!this.recording) {
      return
    }
    const recorder = getSharedVoiceRecorder()
    if (!recorder.recording()) {
      this.adoptFinishedRecorder()
      return
    }
    // BUG-07.3:录音跨前后台存活时,onHide 停掉的计时器必须在这里恢复,否则
    // elapsedText 冻结、页面与 recorder 失联(自愈后点「录完」报没有进行中的录音)。
    this.startElapsedTimer()
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
      // 与 BUG-07.1 同一不变量:进入确认态必清 message,历史错误文案不得残留。
      this.setData({ state: 'review', durationText: formatDuration(result.durationMs), message: '' })
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
    // BUG-07.1:this.recording 要等 recorder.stop() 回包才置 false,双击的第二次 tap
    // 仍能穿过该守卫,第二次 stop 会被共享 recorder 以「当前没有进行中的录音」同步
    // reject,把页面打到 ready 并写入错误文案;随后第一次 stop 回包又切回 review,
    // 错误文案残留在确认页。这里用 in-flight 实例锁在入口拦截,finally 复位。
    if (!this.recording || this.finishingRecording) {
      return
    }
    this.finishingRecording = true
    const recorder = getSharedVoiceRecorder()
    this.stopElapsedTimer()
    try {
      const result = await recorder.stop()
      this.recording = false
      this.recordingResult = result
      // 进入确认态时显式清空 message:任何历史/竞态残留的错误文案不得带进确认页。
      this.setData({ state: 'review', durationText: formatDuration(result.durationMs), message: '' })
    }
    catch (error) {
      this.recording = false
      this.setData({
        state: 'ready',
        message: error instanceof Error ? error.message : '录音结束失败，请重试',
      })
    }
    finally {
      this.finishingRecording = false
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

  // processing 判定收敛到方法:confirmRecording 入口的 state !== 'review' 守卫会把
  // this.data.state 收窄成 'review',await 之后在同一函数体里再与 'processing' 比较
  // 会被 TS 判为无交集(TS2367);跨方法读取则始终拿到完整的 PageState。
  isProcessing() {
    return this.data.state === 'processing'
  },

  askDeleteRecording() {
    // BUG-07.2:AI 整理中录音已交给上传+建草稿流程,此时「删除重录」既撤不回请求,
    // 还会和完成后的强制跳转打架;入口直接拦截,不弹删除确认弹窗。
    if (this.isProcessing()) {
      return
    }
    this.setData({ deleteDialogOpen: true })
  },

  cancelDeleteRecording() {
    this.setData({ deleteDialogOpen: false })
  },

  confirmDeleteRecording() {
    // BUG-07.2:processing 态拒绝删除(与 askDeleteRecording 双保险):录音已提交,
    // 删除只会造成「已删除却被拽去编辑器」的矛盾体验。
    if (this.isProcessing()) {
      this.setData({ deleteDialogOpen: false })
      return
    }
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
      // BUG-07.2:上传+建草稿的 Promise 不可取消,等待期间页面可能已离开 processing
      // (如状态被复位)。结果返回时复核当前 state,已不在 processing 就丢弃草稿,
      // 不再无条件 redirectTo 把用户拽去编辑器。
      if (!this.isProcessing()) {
        return
      }
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
