import type { MipMessagingModule } from './module'
import type { InboxMessage, InboxMessageId } from './types'
import { isTrustedInboxRoute } from './domain'

const POPUP_TYPES = new Set<InboxMessage['messageType']>(['GROWTH_LEVEL_UP', 'GAME', 'OPERATIONS'])

interface PopupStorage {
  read: () => unknown
  write: (value: string[]) => void
}

interface PopupRuntime {
  showModal: typeof wx.showModal
  navigateTo: (url: string) => Promise<unknown> | void
}

interface PopupIdentity {
  loadSnapshot: () => Promise<{
    authenticated: boolean
    agreements: Array<{ accepted: boolean }>
  }>
}

function presentedIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.length <= 80).slice(-50)
    : []
}

export function createPopupMessagePresenter(
  messaging: MipMessagingModule,
  storage: PopupStorage,
  runtime: PopupRuntime,
) {
  let generation = 0
  let presentingGeneration: number | undefined

  function isCurrent(presentationGeneration: number) {
    return presentationGeneration === generation
  }

  return {
    async showNext() {
      if (presentingGeneration === generation) {
        return false
      }
      const presentationGeneration = generation
      presentingGeneration = presentationGeneration
      try {
        const page = await messaging.listInbox(undefined, { force: true, limit: 10 })
        if (!isCurrent(presentationGeneration)) {
          return false
        }
        const shown = presentedIds(storage.read())
        const candidate = page.items.find(item => (
          !item.readAt && POPUP_TYPES.has(item.messageType) && !shown.includes(item.id)
        ))
        if (!candidate) {
          return false
        }

        const targetRoute = candidate.target?.route
        const canOpenTarget = Boolean(targetRoute && isTrustedInboxRoute(targetRoute))
        const result = await runtime.showModal({
          title: candidate.title,
          content: candidate.body,
          showCancel: canOpenTarget,
          cancelText: '稍后',
          confirmText: canOpenTarget ? '查看' : '知道了',
        }).catch(() => null)
        if (!isCurrent(presentationGeneration)) {
          return false
        }
        if (!result?.confirm) {
          return true
        }

        storage.write([...shown, candidate.id].slice(-50))
        await messaging.markRead(candidate.id as InboxMessageId).catch(() => null)
        if (!isCurrent(presentationGeneration)) {
          return false
        }
        if (canOpenTarget && targetRoute) {
          await runtime.navigateTo(targetRoute)
        }
        return true
      }
      catch {
        return false
      }
      finally {
        if (presentingGeneration === presentationGeneration) {
          presentingGeneration = undefined
        }
      }
    },

    invalidate() {
      generation += 1
      presentingGeneration = undefined
    },
  }
}

export function createPopupForegroundCoordinator(
  identity: PopupIdentity,
  presenter: Pick<ReturnType<typeof createPopupMessagePresenter>, 'showNext'>,
) {
  let foregroundCycle = 0
  let foreground = false

  return {
    async onShow() {
      foreground = true
      const cycle = ++foregroundCycle
      try {
        const snapshot = await identity.loadSnapshot()
        if (foreground && cycle === foregroundCycle
          && snapshot.authenticated && snapshot.agreements.every(item => item.accepted)) {
          await presenter.showNext()
        }
      }
      catch {}
    },

    onHide() {
      foreground = false
      foregroundCycle += 1
    },

    invalidate() {
      foregroundCycle += 1
    },
  }
}

export const _popupTest = { presentedIds }
