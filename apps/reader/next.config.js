const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
const withPWA = require('next-pwa')({
  dest: 'public',
})
const withTM = require('next-transpile-modules')([
  '@flow/internal',
  '@flow/epubjs',
  '@material/material-color-utilities',
])

/**
 * FlowPlus 相对上游的改动：
 *
 * 1. 移除 `i18n`：Next 的 i18n 路由与静态导出（`next export`）互斥；
 *    FlowPlus 改为单语言简体中文（见 src/hooks/useTranslation.ts）。
 * 2. 移除 `withSentryConfig`：上游把作者自己的 Sentry DSN 硬编码在
 *    `sentry.client.config.js` 里（空环境变量也无法覆盖），会把错误上报到
 *    上游的项目；FlowPlus 不做任何遥测。
 * 3. 移除 `output: 'standalone'`：FlowPlus 走「静态导出 + 按需本地投递」，
 *    不使用 Docker，不需要 standalone 产物。
 *
 * @type {import('next').NextConfig}
 **/
const config = {
  pageExtensions: ['ts', 'tsx'],
  webpack(config) {
    return config
  },
}

module.exports = withPWA(withTM(withBundleAnalyzer(config)))
