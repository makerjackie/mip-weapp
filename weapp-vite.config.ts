import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { WeappTailwindcss } from 'weapp-tailwindcss/vite'
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
const env = {
  ...parseEnv(path.join(root, '.env.local')),
  ...process.env,
}

const aliases = {
  '@weapp/shared/cache': path.join(root, 'src/shared/cache.ts'),
  '@weapp/shared/retry': path.join(root, 'src/shared/retry.ts'),
  '@weapp/shared/admin-list': path.join(root, 'src/shared/admin-list.ts'),
  '@weapp/shared/presenter': path.join(root, 'src/shared/presenter.ts'),
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
  resolve: {
    alias: aliases,
  },
  define: {
    __APP_NAME__: JSON.stringify(env.MINI_PROGRAM_NAME || 'MIP'),
    __APP_NAMESPACE__: JSON.stringify(env.APP_NAMESPACE || 'mip'),
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_SHA__: JSON.stringify(env.BUILD_SHA || 'development'),
    __CLOUDBASE_ENV_ID__: JSON.stringify(env.CLOUDBASE_ENV_ID || ''),
    __CLOUDBASE_RESOURCE_APP_ID__: JSON.stringify(env.CLOUDBASE_RESOURCE_APP_ID || ''),
    __MIP_IDENTITY_FUNCTION_NAME__: JSON.stringify(env.MIP_IDENTITY_FUNCTION_NAME || 'mip-identity-api'),
    __MIP_MEDIA_FUNCTION_NAME__: JSON.stringify(env.MIP_MEDIA_FUNCTION_NAME || 'mip-media-api'),
    __MIP_EVENTS_FUNCTION_NAME__: JSON.stringify(env.MIP_EVENTS_FUNCTION_NAME || 'mip-events-api'),
    __MIP_OPPORTUNITIES_FUNCTION_NAME__: JSON.stringify(env.MIP_OPPORTUNITIES_FUNCTION_NAME || 'mip-opportunities-api'),
    __MIP_COMMUNITY_FUNCTION_NAME__: JSON.stringify(env.MIP_COMMUNITY_FUNCTION_NAME || 'mip-community-api'),
    __MIP_COMMERCE_FUNCTION_NAME__: JSON.stringify(env.MIP_COMMERCE_FUNCTION_NAME || 'mip-commerce-api'),
    __MIP_ADMIN_FUNCTION_NAME__: JSON.stringify(env.MIP_ADMIN_FUNCTION_NAME || 'mip-admin-api'),
    __MIP_GROWTH_FUNCTION_NAME__: JSON.stringify(env.MIP_GROWTH_FUNCTION_NAME || 'mip-growth-api'),
    __MIP_GAME_FUNCTION_NAME__: JSON.stringify(env.MIP_GAME_FUNCTION_NAME || 'mip-game-api'),
    __MIP_TASKS_FUNCTION_NAME__: JSON.stringify(env.MIP_TASKS_FUNCTION_NAME || 'mip-tasks-api'),
    __MIP_BANNERS_FUNCTION_NAME__: JSON.stringify(env.MIP_BANNERS_FUNCTION_NAME || 'mip-banners-api'),
    __MIP_AI_FUNCTION_NAME__: JSON.stringify(env.MIP_AI_FUNCTION_NAME || 'mip-ai-api'),
    __MIP_NOTIFICATIONS_FUNCTION_NAME__: JSON.stringify(env.MIP_NOTIFICATIONS_FUNCTION_NAME || 'mip-notifications-api'),
    __MIP_PAY_FUNCTION_NAME__: JSON.stringify(env.MIP_PAY_FUNCTION_NAME || 'mip-cloudpay'),
    __MIP_PAYMENT_MODE__: JSON.stringify(env.MIP_PAYMENT_MODE || 'disabled'),
    __MIP_CATALOG_STAGE__: JSON.stringify(env.MIP_CATALOG_STAGE || 'TEST'),
    __MIP_SUBSCRIBE_TEMPLATES_JSON__: JSON.stringify(env.MIP_SUBSCRIBE_TEMPLATES_JSON || ''),
    __MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS__: JSON.stringify(env.MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS || ''),
  },
  weapp: {
    srcRoot: 'src',
    npm: {
      strategy: 'explicit',
      mainPackage: {
        dependencies: ['tdesign-miniprogram'],
      },
      subPackages: {
        'packages/member': {
          dependencies: ['tdesign-miniprogram'],
        },
        'packages/admin': {
          dependencies: ['tdesign-miniprogram'],
        },
      },
    },
    analyze: {
      budgets: {
        totalBytes: 10 * 1024 * 1024,
        mainBytes: 1.5 * 1024 * 1024,
        subPackageBytes: 2 * 1024 * 1024,
        independentBytes: 2 * 1024 * 1024,
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
  plugins: [
    WeappTailwindcss({
      rem2rpx: true,
      cssEntries: [path.join(root, 'src/app.css')],
    }),
  ],
})
