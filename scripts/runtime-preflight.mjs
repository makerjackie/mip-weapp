#!/usr/bin/env node

import path from 'node:path'
import { assertRuntimePreflight } from './lib/runtime-preflight.mjs'

const root = path.resolve(import.meta.dirname, '..')
const result = await assertRuntimePreflight(root, {
  requiredRoutes: [
    'pages/index/index',
    'pages/explore/index',
    'pages/events/index',
    'pages/membership/index',
    'pages/profile/index',
    'packages/member/profile-edit/index',
    'packages/member/member-detail/index',
    'packages/member/event-detail/index',
    'packages/member/orders/index',
    'packages/member/registrations/index',
    'packages/member/privacy/index',
    'packages/admin/dashboard/index',
    'packages/admin/managed-events/index',
    'packages/admin/event-console/index',
    'packages/admin/events/index',
    'packages/admin/profiles/index',
    'packages/admin/orders/index',
    'packages/admin/audit/index',
  ],
})
console.log(JSON.stringify({ ok: true, ...result }, null, 2))
