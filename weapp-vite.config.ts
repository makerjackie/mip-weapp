import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { defineConfig } from 'weapp-vite'
import { TDesignResolver } from 'weapp-vite/auto-import-components/resolvers'

function parseEnv(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce<Record<string, string>>((result, line) => {
      const match = line.trim().match(/^([A-Z_]\w*)=(.*)$/i)
      if (match) {
        result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
      }
      return result
    }, {})
}

const root = import.meta.dirname
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
const rootEnv = parseEnv(path.join(root, '.env.local'))
// MIP_ENV_DIR selects the target-configuration directory (envs/prod, envs/test);
// process env wins so orchestrators stay explicit. Function names, EnvID,
// payment mode, and catalog stage are baked from the selected directory only.
const envDirSetting = String(process.env.MIP_ENV_DIR || rootEnv.MIP_ENV_DIR || '').trim()
const envDir = envDirSetting
  ? (path.isAbsolute(envDirSetting) ? envDirSetting : path.resolve(root, envDirSetting))
  : root
if (envDirSetting && !fs.existsSync(path.join(envDir, '.env.local'))) {
  throw new Error(`MIP_ENV_DIR target has no .env.local: ${envDirSetting}`)
}
const env = {
  ...(envDir === root ? rootEnv : parseEnv(path.join(envDir, '.env.local'))),
  ...process.env,
}

// Direction-B guard rails (MIW-111): defaults now point at the not-yet-deployed
// test suite, so a production-semantics build must never rely on them.
const clientFunctionDefaults = {
  __MIP_IDENTITY_FUNCTION_NAME__: 'mip-t-identity-api',
  __MIP_MEDIA_FUNCTION_NAME__: 'mip-t-media-api',
  __MIP_EVENTS_FUNCTION_NAME__: 'mip-t-events-api',
  __MIP_OPPORTUNITIES_FUNCTION_NAME__: 'mip-t-opportunities-api',
  __MIP_COMMUNITY_FUNCTION_NAME__: 'mip-t-community-api',
  __MIP_COMMERCE_FUNCTION_NAME__: 'mip-t-commerce-api',
  __MIP_ADMIN_FUNCTION_NAME__: 'mip-t-admin-api',
  __MIP_GROWTH_FUNCTION_NAME__: 'mip-t-growth-api',
  __MIP_GAME_FUNCTION_NAME__: 'mip-t-game-api',
  __MIP_TASKS_FUNCTION_NAME__: 'mip-t-tasks-api',
  __MIP_BANNERS_FUNCTION_NAME__: 'mip-t-banners-api',
  __MIP_AI_FUNCTION_NAME__: 'mip-t-ai-api',
  __MIP_NOTIFICATIONS_FUNCTION_NAME__: 'mip-t-notifications-api',
  __MIP_PAY_FUNCTION_NAME__: 'mip-t-cloudpay',
} as const
const productionIntent = String(env.MIP_PAYMENT_MODE || '').toLowerCase() === 'live'
  || String(env.MIP_CATALOG_STAGE || '').toUpperCase() === 'LIVE'
  || String(env.MIP_DEPLOYMENT_STAGE || '').toLowerCase() === 'production'
if (productionIntent) {
  const envKeys = {
    __MIP_IDENTITY_FUNCTION_NAME__: 'MIP_IDENTITY_FUNCTION_NAME',
    __MIP_MEDIA_FUNCTION_NAME__: 'MIP_MEDIA_FUNCTION_NAME',
    __MIP_EVENTS_FUNCTION_NAME__: 'MIP_EVENTS_FUNCTION_NAME',
    __MIP_OPPORTUNITIES_FUNCTION_NAME__: 'MIP_OPPORTUNITIES_FUNCTION_NAME',
    __MIP_COMMUNITY_FUNCTION_NAME__: 'MIP_COMMUNITY_FUNCTION_NAME',
    __MIP_COMMERCE_FUNCTION_NAME__: 'MIP_COMMERCE_FUNCTION_NAME',
    __MIP_ADMIN_FUNCTION_NAME__: 'MIP_ADMIN_FUNCTION_NAME',
    __MIP_GROWTH_FUNCTION_NAME__: 'MIP_GROWTH_FUNCTION_NAME',
    __MIP_GAME_FUNCTION_NAME__: 'MIP_GAME_FUNCTION_NAME',
    __MIP_TASKS_FUNCTION_NAME__: 'MIP_TASKS_FUNCTION_NAME',
    __MIP_BANNERS_FUNCTION_NAME__: 'MIP_BANNERS_FUNCTION_NAME',
    __MIP_AI_FUNCTION_NAME__: 'MIP_AI_FUNCTION_NAME',
    __MIP_NOTIFICATIONS_FUNCTION_NAME__: 'MIP_NOTIFICATIONS_FUNCTION_NAME',
    __MIP_PAY_FUNCTION_NAME__: 'MIP_PAY_FUNCTION_NAME',
  } as const
  const missing = Object.values(envKeys)
    .filter(envKey => !String(env[envKey] || '').trim())
  if (missing.length) {
    throw new Error(
      `Production-semantics build (payment/catalog/stage) must not rely on test fallbacks; configure explicitly: ${missing.join(', ')}`,
    )
  }
}

const aliases = {
  '@weapp/shared/cache': path.join(root, 'src/shared/cache.ts'),
  '@weapp/shared/retry': path.join(root, 'src/shared/retry.ts'),
  '@weapp/shared/haptics': path.join(root, 'src/shared/haptics.ts'),
  '@weapp/platform/runtime-config': path.join(root, 'src/platform/runtime/config.ts'),
  '@weapp/platform/media-urls': path.join(root, 'src/platform/storage/media-urls.ts'),
  '@weapp/platform/tab-bar': path.join(root, 'src/platform/navigation/tab-bar.ts'),
  '@weapp/platform/navigation': path.join(root, 'src/platform/navigation/index.ts'),
  '@weapp/platform/cloudbase': path.join(root, 'src/platform/cloudbase/runtime.ts'),
}

function aliasPaths() {
  return Object.fromEntries(
    Object.entries(aliases).map(([key, value]) => [
      key,
      [`./${path.relative(root, value).replaceAll(path.sep, '/')}`],
    ]),
  )
}

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        minify: {
          // Keep unused-code cleanup so generated template sidecars are removed.
          compress: true,
          mangle: false,
          codegen: { removeWhitespace: true, legalComments: 'inline' },
        },
      },
    },
  },
  resolve: {
    alias: aliases,
  },
  define: {
    __APP_NAME__: JSON.stringify(env.MINI_PROGRAM_NAME || 'MIP'),
    __APP_NAMESPACE__: JSON.stringify(env.APP_NAMESPACE || 'mip'),
    __APP_VERSION__: JSON.stringify(env.MIP_RELEASE_VERSION || packageJson.version),
    __BUILD_SHA__: JSON.stringify(env.BUILD_SHA || 'development'),
    __CLOUDBASE_ENV_ID__: JSON.stringify(env.CLOUDBASE_ENV_ID || ''),
    __CLOUDBASE_RESOURCE_APP_ID__: JSON.stringify(env.CLOUDBASE_RESOURCE_APP_ID || ''),
    __MIP_IDENTITY_FUNCTION_NAME__: JSON.stringify(env.MIP_IDENTITY_FUNCTION_NAME || clientFunctionDefaults.__MIP_IDENTITY_FUNCTION_NAME__),
    __MIP_MEDIA_FUNCTION_NAME__: JSON.stringify(env.MIP_MEDIA_FUNCTION_NAME || clientFunctionDefaults.__MIP_MEDIA_FUNCTION_NAME__),
    __MIP_EVENTS_FUNCTION_NAME__: JSON.stringify(env.MIP_EVENTS_FUNCTION_NAME || clientFunctionDefaults.__MIP_EVENTS_FUNCTION_NAME__),
    __MIP_OPPORTUNITIES_FUNCTION_NAME__: JSON.stringify(env.MIP_OPPORTUNITIES_FUNCTION_NAME || clientFunctionDefaults.__MIP_OPPORTUNITIES_FUNCTION_NAME__),
    __MIP_COMMUNITY_FUNCTION_NAME__: JSON.stringify(env.MIP_COMMUNITY_FUNCTION_NAME || clientFunctionDefaults.__MIP_COMMUNITY_FUNCTION_NAME__),
    __MIP_COMMERCE_FUNCTION_NAME__: JSON.stringify(env.MIP_COMMERCE_FUNCTION_NAME || clientFunctionDefaults.__MIP_COMMERCE_FUNCTION_NAME__),
    __MIP_ADMIN_FUNCTION_NAME__: JSON.stringify(env.MIP_ADMIN_FUNCTION_NAME || clientFunctionDefaults.__MIP_ADMIN_FUNCTION_NAME__),
    __MIP_GROWTH_FUNCTION_NAME__: JSON.stringify(env.MIP_GROWTH_FUNCTION_NAME || clientFunctionDefaults.__MIP_GROWTH_FUNCTION_NAME__),
    __MIP_GAME_FUNCTION_NAME__: JSON.stringify(env.MIP_GAME_FUNCTION_NAME || clientFunctionDefaults.__MIP_GAME_FUNCTION_NAME__),
    __MIP_TASKS_FUNCTION_NAME__: JSON.stringify(env.MIP_TASKS_FUNCTION_NAME || clientFunctionDefaults.__MIP_TASKS_FUNCTION_NAME__),
    __MIP_BANNERS_FUNCTION_NAME__: JSON.stringify(env.MIP_BANNERS_FUNCTION_NAME || clientFunctionDefaults.__MIP_BANNERS_FUNCTION_NAME__),
    __MIP_AI_FUNCTION_NAME__: JSON.stringify(env.MIP_AI_FUNCTION_NAME || clientFunctionDefaults.__MIP_AI_FUNCTION_NAME__),
    __MIP_NOTIFICATIONS_FUNCTION_NAME__: JSON.stringify(env.MIP_NOTIFICATIONS_FUNCTION_NAME || clientFunctionDefaults.__MIP_NOTIFICATIONS_FUNCTION_NAME__),
    __MIP_PAY_FUNCTION_NAME__: JSON.stringify(env.MIP_PAY_FUNCTION_NAME || clientFunctionDefaults.__MIP_PAY_FUNCTION_NAME__),
    // MIW-119：MIP_PAYMENT_MODE / MIP_CATALOG_STAGE 不再 define 进客户端；
    // env 仅在上方 productionIntent 生产语义护栏里消费。
    __MIP_SUBSCRIBE_TEMPLATES_JSON__: JSON.stringify(env.MIP_SUBSCRIBE_TEMPLATES_JSON || ''),
    __MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS__: JSON.stringify(env.MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS || ''),
  },
  weapp: {
    srcRoot: 'src',
    chunks: {
      sharedMode: 'common',
      // These presentation seams must stay addressable when DevTools returns a stale subpackage common module.
      sharedOverrides: [
        { test: /(?:^|\/)modules\/mip-growth\/badge-presentation\.ts$/, mode: 'path' },
        { test: /(?:^|\/)modules\/mip-identity\/profile-options\.ts$/, mode: 'path' },
      ],
      // sharedOverrides only renames shared chunks; preserveModules keeps the seams standalone
      // even while a single page imports them (archive page no longer uses profile-options).
      preserveModules: [
        /(?:^|\/)modules\/mip-growth\/badge-presentation\.ts$/,
        /(?:^|\/)modules\/mip-identity\/profile-options\.ts$/,
      ],
    },
    copy: {
      include: ['**/*.webp'],
    },
    npm: {
      strategy: 'explicit',
      mainPackage: {
        dependencies: ['tdesign-miniprogram'],
      },
    },
    analyze: {
      budgets: {
        totalBytes: 10 * 1024 * 1024,
        mainBytes: 1.5 * 1024 * 1024,
        subPackageBytes: Math.floor(1.8 * 1024 * 1024),
        independentBytes: Math.floor(1.8 * 1024 * 1024),
        warningRatio: 0.85,
      },
    },
    hmr: { runtime: 'classic' },
    mcp: { enabled: true, autoStart: false },
    forwardConsole: {
      enabled: 'auto',
      logLevels: ['log', 'info', 'warn', 'error'],
      unhandledErrors: true,
    },
    tailwindcss: {
      rem2rpx: true,
      cssEntries: [path.join(root, 'src/app.css')],
    },
    typescript: {
      app: {
        compilerOptions: {
          paths: {
            ...aliasPaths(),
            'tdesign-miniprogram/*': ['./node_modules/tdesign-miniprogram/miniprogram_dist/*'],
          },
        },
      },
    },
    autoImportComponents: { resolvers: [TDesignResolver()] },
  },
})
