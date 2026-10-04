'use strict'

// A copy is an incomplete private editing draft, not a scheduled runtime event.
function eventCopyDraft(source, media, parseJson, tagIds = []) {
  return {
    cloneSourceEventId: source.id,
    tagIds,
    scopeType: source.scope_type, branchId: source.branch_id || '',
    title: '', startsAt: '', endsAt: '', registrationDeadline: '', cancellationDeadline: '',
    summary: source.summary, description: source.description, notices: source.notices || '',
    coverAssetId: source.cover_status === 'READY' ? source.cover_asset_id : '',
    contentMedia: media.map(item => ({ assetId: item.media_asset_id, caption: item.caption || '' })),
    eventTypeKey: source.event_type_key, eventMode: source.event_mode, accessType: source.access_type,
    registrationPolicy: source.registration_policy, albumEnabled: Number(source.album_enabled) === 1,
    albumSubmissionPolicy: source.album_submission_policy,
    venueName: source.venue_name || '', address: source.address || '', cityName: source.city_name || '',
    latitude: source.latitude ?? '', longitude: source.longitude ?? '', onlineUrl: source.online_url || '',
    guideUrl: source.guide_url || '',
    capacity: source.capacity ?? '', waitlistEnabled: Number(source.waitlist_enabled) === 1,
    priceCents: Number(source.price_cents), registrationSchema: parseJson(source.registration_schema_json, []),
  }
}
module.exports = { eventCopyDraft }
