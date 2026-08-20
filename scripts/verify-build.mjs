#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import {
  assertCompiledTDesignRegistrations,
  assertTabBarParity,
} from './lib/ui-contracts.mjs'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(relativePath) {
  const absolute = path.join(root, relativePath)
  if (!fs.existsSync(absolute)) {
    return []
  }
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const appWxss = read('dist/app.wxss')
const membershipWxml = read('dist/pages/membership/index.wxml')
const homeWxml = read('dist/pages/index/index.wxml')
const adminWxml = read('dist/packages/admin/dashboard/index.wxml')
const privacyWxml = read('dist/packages/member/privacy/index.wxml')
const ticketJs = read('dist/packages/member/ticket/index.js')
const tabBarWxml = read('dist/custom-tab-bar/index.wxml')
const caseTabBarWxml = read('dist/components/case-tab-bar/index.wxml')
const tabBarJson = JSON.parse(read('dist/custom-tab-bar/index.json'))
const membershipJson = JSON.parse(read('dist/pages/membership/index.json'))
const homeJson = JSON.parse(read('dist/pages/index/index.json'))
const components = { ...membershipJson.usingComponents, ...homeJson.usingComponents }

assert(appWxss.includes('.bg-canvas'), 'Case design tokens did not reach WXSS')
assert(appWxss.includes('.grid-cols-2'), 'Tailwind grid utilities did not reach WXSS')
assert(!membershipWxml.includes('pb-[calc('), 'Tailwind arbitrary safe-area class was not transformed')
assert(homeWxml.includes('membership-case-home'), 'Runtime-stable home selector is missing')
assert(adminWxml.includes('admin-dashboard-page'), 'Runtime-stable admin selector is missing')
assert(privacyWxml.includes('privacy-account-page'), 'Runtime-stable privacy selector is missing')
assert(Object.values(components).some(value => String(value).includes('tdesign-miniprogram/button')), 'TDesign button was not auto-imported')
assert(Object.values(components).some(value => String(value).includes('tdesign-miniprogram/skeleton')), 'TDesign cold-start skeleton was not auto-imported')
assert(Object.values(tabBarJson.usingComponents).some(value => String(value).includes('tdesign-miniprogram/tab-bar')), 'TDesign custom TabBar was not built')
for (const icon of ['home-filled', 'usergroup-filled', 'calendar-event-filled', 'user-filled']) {
  assert(tabBarWxml.includes(`'${icon}'`), `Built TabBar TDesign icon ${icon} is missing`)
}
assert(tabBarWxml.includes('--td-tab-bar-height: 84rpx') && tabBarWxml.includes('--td-font-body-extraSmall: 20rpx/28rpx'), 'Built TabBar must preserve the compact TDesign scale')
assert(!tabBarWxml.includes('<image') && !tabBarWxml.includes('assets/tab'), 'Built standard TabBar icons must not regress to custom raster assets')
assert(Object.values(tabBarJson.usingComponents).some(value => String(value).includes('tdesign-miniprogram/tab-bar-item')), 'TDesign TabBar item was not built')
assert(
  ticketJs.includes('require("../miniprogram_npm/tdesign-miniprogram/common/shared/qrcode/qrcodegen")'),
  'Member-only QR encoder must be emitted inside the member subpackage',
)
assert(
  !ticketJs.includes('require("../../../miniprogram_npm/tdesign-miniprogram/common/shared/qrcode/qrcodegen")'),
  'Member-only QR encoder must not be loaded from the main package',
)
assert(walk('dist').some(file => !file.startsWith('dist/miniprogram_npm/') && file.endsWith('.wxml') && read(file).includes('<t-icon')), 'Built case pages must retain TDesign interface icons')
assertCompiledTDesignRegistrations({
  buildRoot: path.join(root, 'dist'),
  assert,
  label: 'Membership compiled UI',
})
assertTabBarParity(tabBarWxml, caseTabBarWxml, assert, 'Membership built primary TabBar')
assert(tabBarWxml.includes('safe-area-inset-bottom'), 'Custom TabBar must handle the device safe area')

console.log('Membership case build contract passed')
