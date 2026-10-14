import { IS_SERVER } from '@literal-ui/hooks'
import { atom, AtomEffect, useRecoilState } from 'recoil'

import { RenditionSpread } from '@flow/epubjs/types/rendition'

function localStorageEffect<T>(key: string, defaultValue: T): AtomEffect<T> {
  return ({ setSelf, onSet }) => {
    if (IS_SERVER) return

    const savedValue = localStorage.getItem(key)
    if (savedValue === null) {
      localStorage.setItem(key, JSON.stringify(defaultValue))
    } else {
      setSelf(JSON.parse(savedValue))
    }

    onSet((newValue, _, isReset) => {
      isReset
        ? localStorage.removeItem(key)
        : localStorage.setItem(key, JSON.stringify(newValue))
    })
  }
}

export const navbarState = atom<boolean>({
  key: 'navbar',
  default: false,
})

export interface Settings extends TypographyConfiguration {
  theme?: ThemeConfiguration
  enableTextSelectionMenu?: boolean
}

export interface TypographyConfiguration {
  fontSize?: string
  fontWeight?: number
  fontFamily?: string
  lineHeight?: number
  spread?: RenditionSpread
  zoom?: number
}

interface ThemeConfiguration {
  source?: string
  background?: number
}

export const defaultSettings: Settings = {}

const settingsState = atom<Settings>({
  key: 'settings',
  default: defaultSettings,
  effects: [localStorageEffect('settings', defaultSettings)],
})

export function useSettings() {
  return useRecoilState(settingsState)
}

/* ------------------------------------------------------------------ *
 * FlowPlus 新增：图书馆视图 / 排序 / 搜索（Phase 8）
 * ------------------------------------------------------------------ */

/** 排序键（R5）：最近访问 / 按文件名 */
export type SortKey = 'recent' | 'name'

/** 当前图书馆视图：全部书籍，或某个文件夹 */
export type LibraryView = { type: 'all' } | { type: 'folder'; id: string }

export const defaultLibraryView: LibraryView = { type: 'all' }

export const libraryViewState = atom<LibraryView>({
  key: 'libraryView',
  default: defaultLibraryView,
  effects: [localStorageEffect<LibraryView>('libraryView', defaultLibraryView)],
})

export const sortState = atom<SortKey>({
  key: 'sort',
  default: 'recent',
  effects: [localStorageEffect<SortKey>('sort', 'recent')],
})

/** 书名搜索关键词（跨文件夹）；空字符串 = 未搜索 */
export const searchState = atom<string>({
  key: 'search',
  default: '',
})

export function useLibraryView() {
  return useRecoilState(libraryViewState)
}

export function useSort() {
  return useRecoilState(sortState)
}

export function useSearch() {
  return useRecoilState(searchState)
}
