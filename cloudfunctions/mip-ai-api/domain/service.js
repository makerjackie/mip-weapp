'use strict'

const { createHash } = require('node:crypto')

const {
  combineDraftTranscript,
  normalizeDigitalAvatarIntent,
  normalizeRefinementIntent,
  normalizeTextIntent,
  normalizeVoiceIntent,
  normalizeVoiceUploadIntent,
} = require('./validation')

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

  async function claimCreate(caller, input, kind, extra = {}) {
    const inputHash = draftRequestHash(kind, input)
    const claim = await repository.claimDraftRequest(caller.appId, caller.userId, {
      requestId: input.requestId,
      inputHash,
      kind,
      purpose: input.purpose,
      ...extra,
    })
    if (claim.state === 'REPLAY') return { replay: claim.response }
    return { claim, inputHash }
  }

  async function failCreateRequest(caller, request, failureCode) {
    if (!request) return
    await repository.failDraftRequest(caller.appId, caller.userId, {
      requestId: request.claim.requestId,
      inputHash: request.inputHash,
      leaseToken: request.claim.leaseToken,
    }, failureCode).catch(() => false)
  }

  async function handleCreateProviderFailure(caller, request, draft, error) {
    const normalized = normalizeProviderError(error)
    if (isTerminalProviderError(normalized)) {
      if (request) {
        await repository.failKeyedDraft(caller.appId, caller.userId, {
          requestId: request.claim.requestId,
          inputHash: request.inputHash,
          leaseToken: request.claim.leaseToken,
          draftId: draft.id,
          expectedVersion: draft.version,
        }, normalized.message)
      }
      else {
        await repository.failDraft(caller.appId, caller.userId, draft.id, draft.version)
      }
    }
    return normalized
  }

  async function completeKeyedDraft(caller, request, draft, result) {
    try {
      return await repository.completeKeyedDraft(
        caller.appId,
        caller.userId,
        {
          requestId: request.claim.requestId,
          inputHash: request.inputHash,
          leaseToken: request.claim.leaseToken,
          draftId: draft.id,
          expectedVersion: draft.version,
        },
        result,
      )
    }
    catch (error) {
      const recovered = await repository.recoverCompletedDraftRequest(
        caller.appId,
        caller.userId,
        { requestId: request.claim.requestId, inputHash: request.inputHash },
      ).catch(() => null)
      if (recovered) return recovered
      throw error
    }
  }

  async function createKeyedTextDraft(caller, input) {
    const request = await claimCreate(caller, input, 'TEXT', { transcriptText: input.transcriptText })
    if (request.replay) return request.replay
    const draft = request.claim.draft
    let result
    try {
      result = await provider.structureText({
        appId: caller.appId,
        draftId: draft.id,
        purpose: input.purpose,
        expectedVersion: draft.version,
        transcriptText: input.transcriptText,
      })
    }
    catch (error) {
      throw await handleCreateProviderFailure(caller, request, draft, error)
    }
    return completeKeyedDraft(caller, request, draft, {
      ...result,
      purpose: input.purpose,
    })
  }

  async function createKeyedVoiceDraft(caller, input) {
    const request = await claimCreate(caller, input, 'VOICE_ASSET', { audioAssetId: input.audioAssetId })
    if (request.replay) return request.replay
    const created = { draft: request.claim.draft, asset: request.claim.asset }
    let result
    try {
      result = await provider.transcribeAndStructure(voiceProviderInput(caller, created, input.purpose))
    }
    catch (error) {
      throw await handleCreateProviderFailure(caller, request, created.draft, error)
    }
    return completeKeyedDraft(
      caller,
      request,
      created.draft,
      { ...result, purpose: input.purpose },
    )
  }

  async function createKeyedVoiceUploadDraft(caller, input) {
    const candidate = options.audioStore.preallocate({
      appId: caller.appId,
      userId: caller.userId,
    })
    const request = await claimCreate(caller, input, 'VOICE_UPLOAD', { allocation: candidate })
    if (request.replay) return request.replay
    let created
    if (request.claim.draft && request.claim.asset) {
      created = { draft: request.claim.draft, asset: request.claim.asset }
    }
    else {
      let asset
      try {
        asset = await options.audioStore.store({
          appId: caller.appId,
          userId: caller.userId,
          audioBase64: input.audioBase64,
          contentType: input.contentType,
          ...request.claim.allocation,
        })
      }
      catch (error) {
        const code = errorCode(error, 'AI_AUDIO_UPLOAD_FAILED')
        if (['AI_AUDIO_INVALID', 'AI_AUDIO_FILE_INVALID', 'AI_STORAGE_UNAVAILABLE'].includes(code)) {
          await failCreateRequest(caller, request, code)
          throw new Error(code)
        }
        throw new Error('AI_AUDIO_UPLOAD_RESULT_UNKNOWN')
      }
      try {
        created = await repository.createVoiceDraftFromUpload(
          caller.appId,
          caller.userId,
          asset,
          input.purpose,
          request.claim.draftId,
        )
      }
      catch (error) {
        let outcome = await repository.recoverVoiceDraftFromUpload(
          caller.appId,
          caller.userId,
          asset.assetId,
        ).catch(() => ({ state: 'UNKNOWN' }))
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
              outcome = await repository.recoverVoiceDraftFromUpload(
                caller.appId,
                caller.userId,
                asset.assetId,
              ).catch(() => ({ state: 'UNKNOWN' }))
            }
          }
          const code = errorCode(error, 'SERVICE_UNAVAILABLE')
          if (outcome.state === 'PENDING' && ['FORBIDDEN', 'VALIDATION_FAILED'].includes(code)) {
            await failCreateRequest(caller, request, code)
            throw error
          }
          throw new Error('AI_AUDIO_UPLOAD_RESULT_UNKNOWN')
        }
      }
    }

    let result
    try {
      result = await provider.transcribeAndStructure(voiceProviderInput(caller, created, input.purpose))
    }
    catch (error) {
      throw await handleCreateProviderFailure(caller, request, created.draft, error)
    }
    return completeKeyedDraft(
      caller,
      request,
      created.draft,
      { ...result, purpose: input.purpose },
    )
  }

  return {
    async getCapability() {
      const capability = provider.capability()
      let normalized = {
        textDrafts: capability.textDrafts === true,
        voiceDrafts: capability.voiceDrafts === true,
        refinementDrafts: capability.refinementDrafts === true,
        digitalAvatars: capability.digitalAvatars === true,
        ...(capability.reason ? { reason: capability.reason } : {}),
      }
      if (normalized.voiceDrafts && !options.audioStore?.configured) {
        normalized = {
          ...normalized,
          voiceDrafts: false,
          reason: 'STORAGE_NOT_CONFIGURED',
        }
      }
      if (normalized.digitalAvatars && !options.avatarStore?.configured) {
        normalized = {
          ...normalized,
          digitalAvatars: false,
          reason: 'STORAGE_NOT_CONFIGURED',
        }
      }
      let providerReady = true
      if ((normalized.textDrafts || normalized.voiceDrafts || normalized.refinementDrafts)
        && typeof provider.readiness === 'function') {
        try {
          providerReady = await provider.readiness()
        }
        catch {
          providerReady = false
        }
      }
      if (!providerReady) {
        normalized = {
          ...normalized,
          textDrafts: false,
          voiceDrafts: false,
          refinementDrafts: false,
          reason: 'PROVIDER_NOT_CONFIGURED',
        }
      }
      let avatarProviderReady = true
      if (normalized.digitalAvatars && typeof provider.avatarReadiness === 'function') {
        try {
          avatarProviderReady = await provider.avatarReadiness()
        }
        catch {
          avatarProviderReady = false
        }
      }
      if (!avatarProviderReady) {
        normalized = {
          ...normalized,
          digitalAvatars: false,
          reason: 'PROVIDER_NOT_CONFIGURED',
        }
      }
      return normalized
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

    async listDigitalAvatars(caller, event) {
      await repository.expireAvatarGenerations(caller.appId, caller.userId)
      return repository.listAvatarGenerations(caller.appId, caller.userId, event)
    },

    async generateDigitalAvatar(caller, event) {
      assertProvider(provider.capability(), 'digitalAvatars')
      if (!options.avatarStore?.configured) throw new Error('DIGITAL_AVATAR_STORAGE_UNAVAILABLE')
      const input = normalizeDigitalAvatarIntent(event)
      const created = await repository.createAvatarGeneration(caller.appId, caller.userId, input)
      if (created.replayed) {
        if (created.generation.status === 'READY') return created.generation
        if (created.generation.status === 'FAILED') {
          throw new Error(created.generation.failureCode || 'DIGITAL_AVATAR_GENERATION_FAILED')
        }
        throw new Error('DIGITAL_AVATAR_GENERATION_IN_PROGRESS')
      }
      const expectedVersion = created.generation.version
      let providerResult
      try {
        providerResult = await provider.generateDigitalAvatar({
          appId: caller.appId,
          generationId: created.generation.id,
          styleKey: input.styleKey,
          sourceImageFileId: created.source.cloudFileId,
          sourceContentSha256: created.source.contentSha256,
          sourceContentType: created.source.contentType,
          sourceContentBytes: created.source.contentBytes,
          sourceWidth: created.source.width,
          sourceHeight: created.source.height,
        })
      }
      catch (error) {
        const normalized = normalizeAvatarProviderError(error)
        await repository.failAvatarGeneration(
          caller.appId,
          caller.userId,
          created.generation.id,
          expectedVersion,
          normalized.message,
        ).catch(() => false)
        throw normalized
      }

      let output
      try {
        output = await options.avatarStore.store({
          appId: caller.appId,
          userId: caller.userId,
          imageBase64: providerResult.imageBase64,
          contentType: providerResult.contentType,
        })
      }
      catch (error) {
        const normalized = normalizeAvatarOutputError(error)
        await repository.failAvatarGeneration(
          caller.appId,
          caller.userId,
          created.generation.id,
          expectedVersion,
          normalized.message,
        ).catch(() => false)
        throw normalized
      }

      try {
        await repository.registerPendingAvatarOutput(caller.appId, output)
        return await repository.completeAvatarGeneration(
          caller.appId,
          caller.userId,
          created.generation.id,
          expectedVersion,
          output,
          providerResult.providerJobKey,
        )
      }
      catch (error) {
        let outcome = { state: 'UNKNOWN' }
        try {
          outcome = await repository.recoverAvatarGenerationOutput(
            caller.appId,
            caller.userId,
            created.generation.id,
            output.assetId,
          )
        }
        catch {}
        if (outcome.state === 'COMMITTED') return outcome.generation
        if (outcome.state === 'MISSING' || outcome.state === 'PENDING') {
          const removed = await options.avatarStore.remove({
            appId: caller.appId,
            userId: caller.userId,
            objectKey: output.objectKey,
            fileId: output.cloudFileId,
          }).catch(() => false)
          if (removed && outcome.state === 'PENDING') {
            await repository.markPendingAvatarOutputDeleted(caller.appId, output.assetId)
              .catch(() => false)
          }
        }
        await repository.failAvatarGeneration(
          caller.appId,
          caller.userId,
          created.generation.id,
          expectedVersion,
          errorCode(error, 'DIGITAL_AVATAR_GENERATION_FAILED'),
        ).catch(() => false)
        throw error
      }
    },

    async createTextDraft(caller, event) {
      assertProvider(provider.capability(), 'textDrafts')
      const input = normalizeTextIntent(event)
      if (input.requestId) return createKeyedTextDraft(caller, input)
      const draft = await repository.createTextDraft(caller.appId, caller.userId, input)
      let result
      try {
        result = await provider.structureText({
          appId: caller.appId,
          draftId: draft.id,
          purpose: input.purpose,
          expectedVersion: draft.version,
          transcriptText: input.transcriptText,
        })
      }
      catch (error) {
        throw await handleCreateProviderFailure(caller, null, draft, error)
      }
      return repository.completeDraft(caller.appId, caller.userId, draft.id, draft.version, {
        ...result,
        purpose: input.purpose,
      })
    },

    async createVoiceDraft(caller, event) {
      assertProvider(provider.capability(), 'voiceDrafts')
      const input = normalizeVoiceIntent(event)
      if (input.requestId) return createKeyedVoiceDraft(caller, input)
      const created = await repository.createVoiceDraft(caller.appId, caller.userId, input)
      let result
      try {
        result = await provider.transcribeAndStructure({
          appId: caller.appId,
          draftId: created.draft.id,
          purpose: input.purpose,
          expectedVersion: created.draft.version,
          audioFileId: created.asset.cloud_file_id,
          audioContentSha256: created.asset.content_sha256,
          audioContentType: created.asset.content_type,
          audioContentBytes: Number(created.asset.content_bytes),
        })
      }
      catch (error) {
        throw await handleCreateProviderFailure(caller, null, created.draft, error)
      }
      return repository.completeDraft(caller.appId, caller.userId, created.draft.id, created.draft.version, {
        ...result,
        purpose: input.purpose,
      })
    },

    async createVoiceDraftUpload(caller, event) {
      assertProvider(provider.capability(), 'voiceDrafts')
      if (!options.audioStore?.configured) throw new Error('AI_STORAGE_UNAVAILABLE')
      const input = normalizeVoiceUploadIntent(event)
      if (input.requestId) return createKeyedVoiceUploadDraft(caller, input)
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
            const code = errorCode(error, 'SERVICE_UNAVAILABLE')
            if (!['FORBIDDEN', 'VALIDATION_FAILED'].includes(code)) {
              throw new Error('AI_AUDIO_UPLOAD_RESULT_UNKNOWN')
            }
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
      let result
      try {
        result = await provider.transcribeAndStructure({
          appId: caller.appId,
          draftId: created.draft.id,
          purpose: input.purpose,
          expectedVersion: created.draft.version,
          audioFileId: created.asset.cloud_file_id,
          audioContentSha256: created.asset.content_sha256,
          audioContentType: created.asset.content_type,
          audioContentBytes: Number(created.asset.content_bytes),
        })
      }
      catch (error) {
        throw await handleCreateProviderFailure(caller, null, created.draft, error)
      }
      return repository.completeDraft(caller.appId, caller.userId, created.draft.id, created.draft.version, {
        ...result,
        purpose: input.purpose,
      })
    },

    async continueDraft(caller, event) {
      assertProvider(provider.capability(), 'refinementDrafts')
      const input = normalizeRefinementIntent(event)
      const processing = await repository.beginDraftRefinement(caller.appId, caller.userId, input)
      let result
      try {
        result = await provider.refineDraft({
          appId: caller.appId,
          draftId: processing.id,
          purpose: processing.purpose,
          expectedVersion: processing.version,
          currentTranscript: processing.transcriptText || '',
          currentStructuredDraft: processing.structuredDraft || {},
          supplementalText: input.supplementalText,
        })
      }
      catch (error) {
        await repository.restoreDraftAfterRefinement(
          caller.appId,
          caller.userId,
          processing.id,
          processing.version,
        ).catch(() => false)
        throw normalizeProviderError(error)
      }
      const transcriptText = combineDraftTranscript(
        processing.transcriptText,
        input.supplementalText,
      )
      try {
        return await repository.completeDraft(
          caller.appId,
          caller.userId,
          processing.id,
          processing.version,
          { ...result, transcriptText, purpose: processing.purpose },
        )
      }
      catch (error) {
        const recovered = await repository.getDraft(
          caller.appId,
          caller.userId,
          processing.id,
        ).catch(() => null)
        if (recovered?.status === 'DRAFT_READY'
          && recovered.version === processing.version + 1) {
          return recovered
        }
        await repository.restoreDraftAfterRefinement(
          caller.appId,
          caller.userId,
          processing.id,
          processing.version,
        ).catch(() => false)
        throw error
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
  if (['AI_PROVIDER_REJECTED', 'AI_PROVIDER_RESPONSE_INVALID'].includes(code)) {
    return error
  }
  return new Error('AI_PROVIDER_RESULT_UNKNOWN')
}

function isTerminalProviderError(error) {
  return error instanceof Error
    && ['AI_PROVIDER_REJECTED', 'AI_PROVIDER_RESPONSE_INVALID'].includes(error.message)
}

function normalizeAvatarProviderError(error) {
  const code = errorCode(error, '')
  if (code === 'DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID') return new Error(code)
  return new Error('DIGITAL_AVATAR_PROVIDER_UNAVAILABLE')
}

function normalizeAvatarOutputError(error) {
  const code = errorCode(error, '')
  const allowed = new Set([
    'DIGITAL_AVATAR_CONTENT_REJECTED',
    'DIGITAL_AVATAR_IMAGE_DIMENSIONS_INVALID',
    'DIGITAL_AVATAR_IMAGE_INVALID',
    'DIGITAL_AVATAR_IMAGE_TOO_LARGE',
    'DIGITAL_AVATAR_SAFETY_UNAVAILABLE',
    'DIGITAL_AVATAR_STORAGE_UNAVAILABLE',
    'DIGITAL_AVATAR_UPLOAD_FAILED',
  ])
  return new Error(allowed.has(code) ? code : 'DIGITAL_AVATAR_UPLOAD_FAILED')
}

function errorCode(error, fallback) {
  const code = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : fallback
}

function draftRequestHash(kind, input) {
  const fields = kind === 'TEXT'
    ? [input.purpose, input.transcriptText]
    : kind === 'VOICE_ASSET'
      ? [input.purpose, input.audioAssetId]
      : kind === 'VOICE_UPLOAD'
        ? [input.purpose, input.contentType, input.audioBase64]
        : null
  if (!fields) throw new Error('VALIDATION_FAILED')
  return createHash('sha256')
    .update('MIP_AI_DRAFT_REQUEST_V1\0')
    .update(kind)
    .update('\0')
    .update(JSON.stringify(fields))
    .digest('hex')
}

function voiceProviderInput(caller, created, purpose) {
  return {
    appId: caller.appId,
    draftId: created.draft.id,
    purpose,
    expectedVersion: created.draft.version,
    audioFileId: created.asset.cloud_file_id,
    audioContentSha256: created.asset.content_sha256,
    audioContentType: created.asset.content_type,
    audioContentBytes: Number(created.asset.content_bytes),
  }
}

module.exports = {
  createAiService,
  draftRequestHash,
  isTerminalProviderError,
  normalizeAvatarOutputError,
  normalizeAvatarProviderError,
  normalizeProviderError,
}
