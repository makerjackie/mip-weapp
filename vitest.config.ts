import path from 'node:path'
import { defineConfig } from 'vitest/config'

const root = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      '@weapp/shared/cache': path.join(root, 'src/shared/cache.ts'),
      '@weapp/shared/retry': path.join(root, 'src/shared/retry.ts'),
      '@weapp/shared/haptics': path.join(root, 'src/shared/haptics.ts'),
      '@weapp/platform/runtime-config': path.join(root, 'src/platform/runtime/config.ts'),
      '@weapp/platform/media-urls': path.join(root, 'src/platform/storage/media-urls.ts'),
      '@weapp/platform/tab-bar': path.join(root, 'src/platform/navigation/tab-bar.ts'),
      '@weapp/platform/navigation': path.join(root, 'src/platform/navigation/index.ts'),
      '@weapp/platform/cloudbase': path.join(root, 'src/platform/cloudbase/runtime.ts'),
    },
  },
  // Mirror the weapp-vite define contract so tests may import src/config/runtime.ts
  // directly; values are neutral test constants (test-suite function names).
  define: {
    __APP_NAME__: JSON.stringify('MIP Test'),
    __APP_NAMESPACE__: JSON.stringify('mip'),
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __BUILD_SHA__: JSON.stringify('test'),
    __CLOUDBASE_ENV_ID__: JSON.stringify(''),
    __CLOUDBASE_RESOURCE_APP_ID__: JSON.stringify(''),
    __MIP_IDENTITY_FUNCTION_NAME__: JSON.stringify('mip-t-identity-api'),
    __MIP_MEDIA_FUNCTION_NAME__: JSON.stringify('mip-t-media-api'),
    __MIP_EVENTS_FUNCTION_NAME__: JSON.stringify('mip-t-events-api'),
    __MIP_OPPORTUNITIES_FUNCTION_NAME__: JSON.stringify('mip-t-opportunities-api'),
    __MIP_COMMUNITY_FUNCTION_NAME__: JSON.stringify('mip-t-community-api'),
    __MIP_COMMERCE_FUNCTION_NAME__: JSON.stringify('mip-t-commerce-api'),
    __MIP_ADMIN_FUNCTION_NAME__: JSON.stringify('mip-t-admin-api'),
    __MIP_GROWTH_FUNCTION_NAME__: JSON.stringify('mip-t-growth-api'),
    __MIP_GAME_FUNCTION_NAME__: JSON.stringify('mip-t-game-api'),
    __MIP_TASKS_FUNCTION_NAME__: JSON.stringify('mip-t-tasks-api'),
    __MIP_BANNERS_FUNCTION_NAME__: JSON.stringify('mip-t-banners-api'),
    __MIP_AI_FUNCTION_NAME__: JSON.stringify('mip-t-ai-api'),
    __MIP_NOTIFICATIONS_FUNCTION_NAME__: JSON.stringify('mip-t-notifications-api'),
    __MIP_PAY_FUNCTION_NAME__: JSON.stringify('mip-t-cloudpay'),
    __MIP_SUBSCRIBE_TEMPLATES_JSON__: JSON.stringify(''),
    __MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS__: JSON.stringify(''),
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
