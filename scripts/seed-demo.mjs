#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlJson,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const appId = env.MINI_PROGRAM_APP_ID
if (!process.argv.includes('--confirm-demo')) {
  throw new Error('Development seed requires --confirm-demo')
}
if (!envId || !appId) {
  throw new Error('CLOUDBASE_ENV_ID and MINI_PROGRAM_APP_ID are required in the case .env.local')
}
if (!/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('MINI_PROGRAM_APP_ID is invalid')
}

const target = bindAndRequireMysqlEnvironment(root, envId, {
  development: true,
  stage: env.MEMBERSHIP_DEPLOYMENT_STAGE,
})
callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: 'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = \'member_media_assets\'',
})

const assetRoot = path.join(root, 'assets', 'demo')
const manifest = JSON.parse(fs.readFileSync(path.join(assetRoot, 'manifest.json'), 'utf8'))
if (manifest.environment !== 'development' || manifest.provenance !== 'openai-imagegen-synthetic') {
  throw new Error('Demo manifest provenance is invalid')
}

function cloudFileId(value, cloudPath) {
  if (typeof value === 'string' && value.startsWith('cloud://')) {
    return value
  }
  if (!value || typeof value !== 'object') {
    return null
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:fileid|file_id|cloudfileid)$/i.test(key) && typeof child === 'string' && child.startsWith('cloud://')) {
      return child
    }
  }
  for (const child of Object.values(value)) {
    const found = cloudFileId(child, cloudPath)
    if (found) {
      return found
    }
  }
  const bucket = target.environment?.Storages?.[0]?.Bucket
  if (!bucket || !cloudPath) {
    return null
  }
  return `cloud://${envId}.${bucket}/${cloudPath}`
}

function assertAsset(asset) {
  const filePath = path.join(assetRoot, asset.file)
  const bytes = fs.readFileSync(filePath)
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== asset.bytes || digest !== asset.sha256) {
    throw new Error(`Asset integrity failed: ${asset.key}`)
  }
  return filePath
}

function shanghaiDateParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  return Object.fromEntries(parts.map(item => [item.type, item.value]))
}

function scheduleFor(event) {
  if (!event.schedule) {
    return {
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      registrationDeadline: event.registrationDeadline,
    }
  }
  const today = shanghaiDateParts()
  const hour = Number(event.schedule.startHourLocal)
  const minute = Number(event.schedule.startMinuteLocal || 0)
  const start = new Date(Date.UTC(
    Number(today.year),
    Number(today.month) - 1,
    Number(today.day) + Number(event.schedule.startsInDays),
    hour - 8,
    minute,
  ))
  const end = new Date(start.getTime() + Number(event.schedule.durationMinutes) * 60 * 1000)
  const deadline = new Date(start.getTime() - Number(event.schedule.registrationClosesHoursBefore) * 60 * 60 * 1000)
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    registrationDeadline: deadline.toISOString(),
  }
}

function mysqlDateLiteral(value) {
  return sqlLiteral(new Date(value).toISOString().replace('T', ' ').replace('Z', ''))
}

const uploaded = []
for (const asset of manifest.assets) {
  const localPath = assertAsset(asset)
  const response = callCloudbase(root, 'manageStorage', {
    action: 'upload',
    localPath,
    cloudPath: asset.objectKey,
    force: true,
  }, 300000)
  const fileId = cloudFileId(response, asset.objectKey)
  if (!fileId) {
    throw new Error(`CloudBase upload did not return a cloud file ID for ${asset.key}`)
  }
  uploaded.push({ ...asset, cloudFileId: fileId })
  console.log(`[seed-demo] uploaded ${asset.key}`)
}

const assetValues = uploaded.map(asset => `(
  UUID(), ${sqlLiteral(appId)}, ${sqlLiteral(asset.key)}, ${sqlLiteral(asset.kind)},
  ${sqlLiteral(asset.cloudFileId)}, ${sqlLiteral(asset.objectKey)},
  ${Number(asset.width)}, ${Number(asset.height)}, ${Number(asset.bytes)},
  ${sqlLiteral(asset.mimeType)}, ${sqlLiteral(asset.altText)}, ${sqlLiteral(asset.sha256)},
  ${sqlLiteral(manifest.provenance)}, 1, 'READY', 1
)`).join(',\n')

const profileValues = manifest.profiles.map(profile => `(
  UUID(), ${sqlLiteral(appId)}, ${sqlLiteral(profile.key)}, ${sqlLiteral(`demo:${profile.key}`)}, ${sqlLiteral(profile.nickname)},
  ${sqlLiteral(profile.city)}, ${sqlLiteral(profile.headline)},
  ${sqlLiteral(profile.organization || '')}, ${sqlLiteral(profile.roleTitle || '')},
  ${sqlLiteral(profile.industry || '')}, ${sqlLiteral(profile.bio)},
  ${sqlJson(profile.tags)}, ${sqlJson(profile.interests || [])}, ${sqlJson(profile.skills || [])},
  (select id from member_media_assets
   where app_id = ${sqlLiteral(appId)} and asset_key = ${sqlLiteral(profile.avatarKey)}
   and content_version = 1),
  'APPROVED', 1, UTC_TIMESTAMP(3)
)`).join(',\n')

const eventValues = manifest.events.map((event) => {
  const schedule = scheduleFor(event)
  return `(
  UUID(), ${sqlLiteral(appId)}, ${sqlLiteral(event.key)}, ${sqlLiteral(event.title)},
  ${sqlLiteral(event.summary)}, ${sqlLiteral(event.description)}, ${sqlLiteral(event.notices || '')},
  ${sqlJson(event.registrationSchema || [])}, 1,
  ${sqlLiteral(event.registrationMode || 'AUTO')}, ${event.waitlistEnabled ? '1' : '0'},
  ${event.albumEnabled === false ? '0' : '1'}, ${event.albumRequiresReview === false ? '0' : '1'},
  ${sqlLiteral(event.eventMode || 'OFFLINE')},
  ${mysqlDateLiteral(schedule.startsAt)}, ${mysqlDateLiteral(schedule.endsAt)},
  ${mysqlDateLiteral(schedule.registrationDeadline)},
  ${sqlLiteral(event.venueName || event.location)}, ${sqlLiteral(event.location)},
  ${sqlLiteral(event.address)}, ${event.latitude ?? 'NULL'}, ${event.longitude ?? 'NULL'},
  ${event.onlineUrl ? sqlLiteral(event.onlineUrl) : 'NULL'}, ${Number(event.capacity)},
  ${sqlLiteral(event.cancellationPolicy || '')},
  ${Number(event.priceCents)}, ${event.memberFree ? '1' : '0'},
  (select id from member_media_assets
   where app_id = ${sqlLiteral(appId)} and asset_key = ${sqlLiteral(event.coverKey)}
   and content_version = 1),
  'PUBLISHED', 1
)`
}).join(',\n')

const statements = [`insert into member_media_assets (
  id, app_id, asset_key, kind, cloud_file_id, object_key, width, height, bytes,
  mime_type, alt_text, sha256, provenance, content_version, status, is_demo
) values
${assetValues}
on duplicate key update
  kind = values(kind),
  cloud_file_id = values(cloud_file_id),
  object_key = values(object_key),
  width = values(width),
  height = values(height),
  bytes = values(bytes),
  mime_type = values(mime_type),
  alt_text = values(alt_text),
  sha256 = values(sha256),
  provenance = values(provenance),
  status = 'READY',
  is_demo = 1`, `insert into member_profiles (
  id, app_id, external_key, user_id, nickname, city, headline,
  organization, role_title, industry, bio, tags, interests, skills,
  avatar_asset_id, status, is_demo, approved_at
) values
${profileValues}
on duplicate key update
  user_id = values(user_id),
  nickname = values(nickname),
  city = values(city),
  headline = values(headline),
  organization = values(organization),
  role_title = values(role_title),
  industry = values(industry),
  bio = values(bio),
  tags = values(tags),
  interests = values(interests),
  skills = values(skills),
  avatar_asset_id = values(avatar_asset_id),
  status = 'APPROVED',
  is_demo = 1,
  approved_at = UTC_TIMESTAMP(3),
  updated_at = UTC_TIMESTAMP(3)`, `insert into member_events (
  id, app_id, external_key, title, summary, description, notices,
  registration_schema, form_version, registration_mode, waitlist_enabled,
  album_enabled, album_requires_review, event_mode,
  starts_at, ends_at, registration_deadline, venue_name, location, address,
  latitude, longitude, online_url,
  capacity, cancellation_policy, price_cents, member_free,
  cover_asset_id, status, is_demo
) values
${eventValues}
on duplicate key update
  title = values(title),
  summary = values(summary),
  description = values(description),
  notices = values(notices),
  registration_schema = values(registration_schema),
  form_version = values(form_version),
  registration_mode = values(registration_mode),
  waitlist_enabled = values(waitlist_enabled),
  album_enabled = values(album_enabled),
  album_requires_review = values(album_requires_review),
  event_mode = values(event_mode),
  starts_at = values(starts_at),
  ends_at = values(ends_at),
  registration_deadline = values(registration_deadline),
  venue_name = values(venue_name),
  location = values(location),
  address = values(address),
  latitude = values(latitude),
  longitude = values(longitude),
  online_url = values(online_url),
  capacity = values(capacity),
  cancellation_policy = values(cancellation_policy),
  price_cents = values(price_cents),
  member_free = values(member_free),
  cover_asset_id = values(cover_asset_id),
  status = 'PUBLISHED',
  is_demo = 1,
  updated_at = UTC_TIMESTAMP(3)`, `insert into member_announcements (
  id, app_id, title, summary, body, status, is_pinned,
  published_at, created_by, updated_by
) values (
  'a11c0000-0000-4000-8000-000000000001',
  ${sqlLiteral(appId)},
  '本月同行活动开放报名',
  '城市散步、创作者圆桌与 AI 工作流小班现已开放查看。',
  '同行会本月活动已经更新。你可以在“活动”中查看城市散步与晚餐、独立创作者圆桌和 AI 工作流实战小班，了解名额与报名条件。报名成功后，活动变化和开始提醒会出现在“消息通知”；如有临时调整，主办方也会在公告中同步。',
  'PUBLISHED',
  1,
  UTC_TIMESTAMP(3),
  'demo-seed',
  'demo-seed'
) on duplicate key update
  title = values(title),
  summary = values(summary),
  body = values(body),
  status = 'PUBLISHED',
  is_pinned = 1,
  updated_by = 'demo-seed',
  updated_at = UTC_TIMESTAMP(3)`, `insert into member_registrations (
  id, app_id, event_id, user_id, status, ticket_code, source_order_id,
  form_version, answer_snapshot, share_profile, version, registered_at
)
select
  UUID(), ${sqlLiteral(appId)}, e.id, p.user_id, 'REGISTERED',
  concat('TDEMO', upper(substr(sha2(concat(p.external_key, ':', e.external_key), 256), 1, 10))),
  null, e.form_version, json_object(), 1, 1,
  timestampadd(minute, field(p.external_key, 'lin-ye', 'chen-xu', 'qiao-an', 'zhou-mo'), e.created_at)
from member_profiles p
inner join member_events e
  on e.app_id = p.app_id and e.external_key = ${sqlLiteral(manifest.events[0].key)}
where p.app_id = ${sqlLiteral(appId)} and p.is_demo = 1 and p.user_id like 'demo:%'
on duplicate key update
  status = 'REGISTERED',
  share_profile = 1,
  answer_snapshot = json_object(),
  updated_at = UTC_TIMESTAMP(3)`, `insert into member_plans (
  app_id, id, name, description, price_cents, duration_days, benefits, environment
) values
  (${sqlLiteral(appId)}, 'annual-member', '同行会年度会员', '完整成员资料、会员活动与优先报名权益', 39900, 365, ${sqlJson(['完整成员资料', '会员活动免费', '活动优先报名'])}, 'live'),
  (${sqlLiteral(appId)}, 'test-10-cents', '会员体验卡', '体验完整会员权益与活动服务', 10, 1, ${sqlJson(['1 天会员权益'])}, 'test')
on duplicate key update
  name = values(name),
  description = values(description),
  price_cents = values(price_cents),
  duration_days = values(duration_days),
  benefits = values(benefits),
  environment = values(environment),
  status = 'ACTIVE',
  updated_at = UTC_TIMESTAMP(3)`]

for (const statement of statements) {
  callCloudbase(root, 'manageMysqlDatabase', {
    action: 'runStatement',
    sql: statement,
  }, 300000)
}

const verification = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `select
    (select count(*) from member_media_assets where app_id = ${sqlLiteral(appId)} and is_demo = 1) as assets,
    (select count(*) from member_profiles where app_id = ${sqlLiteral(appId)} and is_demo = 1) as profiles,
    (select count(*) from member_events where app_id = ${sqlLiteral(appId)} and is_demo = 1) as events,
    (select count(*) from member_announcements where app_id = ${sqlLiteral(appId)} and status = 'PUBLISHED') as announcements,
    (select count(*) from member_registrations r
      inner join member_profiles p on p.app_id = r.app_id and p.user_id = r.user_id
      where r.app_id = ${sqlLiteral(appId)} and p.is_demo = 1 and r.share_profile = 1) as participants,
    (select count(*) from member_plans where app_id = ${sqlLiteral(appId)}) as plans`,
})
const planVerification = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `select name, description, benefits
    from member_plans
    where app_id = ${sqlLiteral(appId)} and id = 'test-10-cents'
    limit 1`,
})

function findRows(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (Array.isArray(value.rows)) {
    return value.rows
  }
  for (const child of Object.values(value)) {
    const rows = findRows(child)
    if (rows) {
      return rows
    }
  }
  return null
}

const [testPlan] = findRows(planVerification) || []
if (
  testPlan?.name !== '会员体验卡'
  || testPlan?.description !== '体验完整会员权益与活动服务'
  || JSON.stringify(testPlan?.benefits) !== JSON.stringify(['1 天会员权益'])
) {
  throw new Error('Development membership plan copy was not updated')
}
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'seed-demo-result.json'), `${JSON.stringify({
  datasetVersion: manifest.datasetVersion,
  environmentVerified: true,
  uploadedAssetKeys: uploaded.map(asset => asset.key),
  verification,
  seededAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[seed-demo] MySQL demo content verified; artifact: .tmp/seed-demo-result.json')
