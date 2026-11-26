import { defineConfig } from 'vitest/config'

/**
 * 单元与组件测试：jsdom 环境，构建期常量在此注入。
 * 覆盖纯逻辑（人格、设置迁移、记忆适配器、提示词、请求重建）与关键组件。
 */
export default defineConfig({
  define: { __API_ORIGIN__: JSON.stringify('https://api.deepseek.com') },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    // 页面组件依赖 matchMedia 等浏览器能力时由各用例自行补齐
    unstubGlobals: true,
  },
})
