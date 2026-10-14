import './styles.css'
import 'react-photo-view/dist/react-photo-view.css'

import { LiteralProvider } from '@literal-ui/core'
import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import { RecoilRoot } from 'recoil'

import { ErrorBoundary, Layout, Theme } from '../components'

export default function MyApp({ Component, pageProps }: AppProps) {
  // FlowPlus：申请持久化存储。
  // 目的是降低浏览器在磁盘紧张时“自动驱逐”缓存与本地库的概率。
  // 注意：它挡不住用户主动清理站点数据（那会连 IndexedDB 一起删掉）。
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {
      // 用户拒绝或浏览器不支持时静默忽略
    })
  }, [])

  return (
    <ErrorBoundary>
      <LiteralProvider>
        <RecoilRoot>
          <Theme />
          <Layout>
            <Component {...pageProps} />
          </Layout>
        </RecoilRoot>
      </LiteralProvider>
    </ErrorBoundary>
  )
}
