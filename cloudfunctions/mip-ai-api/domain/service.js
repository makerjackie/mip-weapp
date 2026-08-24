'use strict'

const { normalizeTextIntent, normalizeVoiceIntent, normalizeVoiceUploadIntent } = require('./validation')

function createAiService(options) {
  const repository = options.repository
  const provider = options.provider

  async function cleanupExpiredAudio(caller) {
    await repository.expireDrafts(caller.appId, caller.userId)
    const assets = await repository.leaseAudioCleanup(caller.appId, caller.userId)
    await deleteLeasedAudio(caller.appId, assets, caller.userId)
  }

  async function deleteLeasedAudio(appId, assets, fallbackUserId) {
    let deleted = 0
    let failed = 0
    for (const asset of assets) {
      const ownerUserId = asset.owner_user_id || fallbackUserId || null
      try {
        const removed = await options.audioStore?.remove({
          appId,
          ...(ownerUserId ? { userId: ownerUserId } : {}),
          objectKey: asset.object_key,
          fileId: asset.cloud_file_id,
        })
        if (!removed) {
          failed += 1
          continue
        }
        const marked = await repository.markAudioDeleted(
          appId,
          ownerUserId,
          asset.id,
          asset.lease_updated_at,
        )
        if (marked) deleted += 1
        else failed += 1
      }
      catch {
        failed += 1
      }
    }
    return { deleted, failed }
  }

  return {
    getCapability() {
      const capability = provider.capability()
      if (!capability.voiceDrafts || options.audioStore?.configured) {
        return capability
      }
      return {
        ...capability,
        voiceDrafts: false,
        reason: 'STORAGE_NOT_CONFIGURED',
      }
    },

    async cleanupExpiredAudioForApp(appId, event = {}) {
      const limit = Number(event.limit ?? 10)
      if (!/^wx[0-9a-f]{16}$/i.test(appId)
        || !Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new Error('AI_CLEANUP_INVALID')
      }
      if (!options.audioStore?.configured) throw new Error('AI_STORAGE_UNAVAILABLE')
      const expired = await repository.expireDraftsForApp(appId, limit)
      const assets = await repository.leaseAppAudioCleanup(appId, limit)
      const result = await deleteLeasedAudio(appId, assets)
      return {
        status: result.failed > 0 ? 'PARTIAL' : 'COMPLETED',
        expired,
        scanned: assets.length,
        ...result,
      }
    },

    async listDrafts(caller, event) {
      await cleanupExpiredAudio(caller)
      return repository.listDrafts(caller.appId, caller.userId, event)
    },

    async getDraft(caller, event) {
      await cleanupExpiredAudio(caller)
      return repository.getDraft(caller.appId, caller.userId, event.draftId)
    },

    async createTextDraft(caller, event) {
      assertProvider(provider.capability(), 'textDrafts')
      const input = normalizeTextIntent(event)
      const draft = await repository.createTextDraft(caller.appId, caller.userId, input)
      try {
        const result = await provider.structureText({
          appId: caller.appId,
          draftId: draft.id,
          purpose: input.purpose,
          transcriptText: input.transcriptText,
        })
        return repository.completeDraft(caller.appId, caller.userId, draft.id, draft.version, {
          ...result,
          purpose: input.purpose,
        })
      }
      catch (error) {
        await repository.failDraft(caller.appId, caller.userId, draft.id, draft.version)
        throw normalizeProviderError(error)
      }
    },

    async createVoiceDraft(caller, event) {
      assertProvider(provider.capability(), 'voiceDrafts')
      const input = normalizeVoiceIntent(event)
      const created = await repository.createVoiceDraft(caller.appId, caller.userId, input)
      try {
        const result = await provider.transcribeAndStructure({
          appId: caller.appId,
          draftId: created.draft.id,
          purpose: input.purpose,
          audioFileId: created.asset.cloud_file_id,
          contentType: created.asset.content_type,
          contentBytes: Number(created.asset.content_bytes),
        })
        return repository.completeDraft(caller.appId, caller.userId, created.draft.id, created.draft.version, {
          ...result,
          purpose: input.purpose,
        })
      }
      catch (error) {
        await repository.failDraft(caller.appId, caller.userId, created.draft.id, created.draft.version)
        throw normalizeProviderError(error)
      }
    },

    async createVoiceDraftUpload(caller, event) {
      assertProvider(provider.capability(), 'voiceDrafts')
      if (!options.audioStore?.configured) throw new Error('AI_STORAGE_UNAVAILABLE')
      const input = normalizeVoiceUploadIntent(event)
      const asset = await options.audioStore.store({
        appId: caller.appId,
        userId: caller.userId,
        audioBase64: input.audioBase64,
        contentType: input.contentType,
      })
      let created
      try {
        created = await repository.createVoiceDraftFromUpload(caller.appId, caller.userId, asset, input.purpose)
      }
      catch (error) {
        let outcome = { state: 'UNKNOWN' }
        try {
          outcome = await repository.recoverVoiceDraftFromUpload(
            caller.appId,
            caller.userId,
            asset.assetId,
          )
        }
        catch {}
        if (outcome.state === 'COMMITTED') {
          created = outcome.created
        }
        else {
          if (outcome.state === 'MISSING') {
            try {
              await repository.registerPendingAudioUpload(caller.appId, asset)
              outcome = { state: 'PENDING' }
            }
            catch {
              try {
                outcome = await repository.recoverVoiceDraftFromUpload(
                  caller.appId,
                  caller.userId,
                  asset.assetId,
                )
              }
              catch {
                outcome = { state: 'UNKNOWN' }
              }
            }
          }
          if (outcome.state === 'COMMITTED') {
            created = outcome.created
          }
          else if (outcome.state === 'PENDING' || outcome.state === 'MISSING') {
            const removed = await options.audioStore.remove({
              appId: caller.appId,
              userId: caller.userId,
              objectKey: asset.objectKey,
              fileId: asset.cloudFileId,
            }).catch(() => false)
            if (removed && outcome.state === 'PENDING') {
              await repository.markPendingAudioUploadDeleted(caller.appId, asset.assetId)
                .catch(() => false)
            }
            throw error
          }
          else {
            throw error
          }
        }
      }
      try {
        const result = await provider.transcribeAndStructure({
          appId: caller.appId,
          draftId: created.draft.id,
          purpose: input.purpose,
          audioFileId: created.asset.cloud_file_id,
          contentType: created.asset.content_type,
          contentBytes: Number(created.asset.content_bytes),
        })
        return repository.completeDraft(caller.appId, caller.userId, created.draft.id, created.draft.version, {
          ...result,
          purpose: input.purpose,
        })
      }
      catch (error) {
        await repository.failDraft(caller.appId, caller.userId, created.draft.id, created.draft.version)
        throw normalizeProviderError(error)
      }
    },

    updateDraft(caller, event) {
      return repository.updateDraft(caller.appId, caller.userId, event)
    },

    async deleteDraft(caller, event) {
      const result = await repository.deleteDraft(caller.appId, caller.userId, event.draftId, Number(event.expectedVersion))
      await cleanupExpiredAudio(caller)
      return result
    },

  }
}

function assertProvider(capability, key) {
  if (!capability[key]) throw new Error('AI_PROVIDER_UNAVAILABLE')
}

function normalizeProviderError(error) {
  const code = error instanceof Error ? error.message : ''
  if (['AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_RESPONSE_INVALID'].includes(code)) {
    return error
  }
  return new Error('AI_PROVIDER_UNAVAILABLE')
}

module.exports = { createAiService, normalizeProviderError }
