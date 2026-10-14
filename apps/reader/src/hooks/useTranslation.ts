import { useCallback } from 'react'

import locales from '../../locales'

// FlowPlus：去 i18n 后固定使用简体中文
// （静态导出与 Next 的 i18n 路由互斥，所以这里不再从 router 取 locale）
const LOCALE = 'zh-CN' as const

export function useTranslation(scope?: string) {
  return useCallback(
    (key: string) => {
      // @ts-ignore
      return locales[LOCALE][scope ? `${scope}.${key}` : key] as string
    },
    [scope],
  )
}
