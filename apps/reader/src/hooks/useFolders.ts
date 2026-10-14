import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'

import { db } from '@flow/reader/db'
import {
  buildFolderTree,
  collectFolderIds,
  isInFolder,
  sortBooks,
} from '@flow/reader/library'
import { SortKey } from '@flow/reader/state'

/**
 * FlowPlus：文件夹 / 排序 / 搜索的 React 查询层（Phase 8）
 *
 * 设计原则：**只加新函数，不动 `useLibrary()`**。
 * `useLibrary()` 被侧栏（LibraryPane）和主区（index.tsx）同时使用，
 * 直接改签名会一次牵动两个界面；这里先提供独立的新 API，让两处逐个切换。
 *
 * 纯逻辑（排序 / 建树 / 子树收集）在 `src/library.ts`，本文件只做「包成 hook」。
 */

/** 全部文件夹（扁平） */
export function useFolders() {
  return useLiveQuery(() => db?.folders.toArray() ?? [], [], [])
}

/** 文件夹树（顶级节点数组，供 flatTree / 缩进渲染使用） */
export function useFolderTree() {
  const folders = useFolders()
  return useMemo(() => buildFolderTree(folders ?? []), [folders])
}

/** 某个文件夹的路径（从顶级到自身），用于面包屑 */
export function useFolderPath(folderId: string | null) {
  const folders = useFolders()
  return useMemo(() => {
    const path: { id: string; name: string }[] = []
    if (!folderId) return path

    const byId = new Map((folders ?? []).map((f) => [f.id, f]))
    const seen = new Set<string>()
    let current = byId.get(folderId)
    while (current && !seen.has(current.id)) {
      seen.add(current.id) // 防脏数据成环
      path.unshift({ id: current.id, name: current.name })
      current =
        current.parentId !== null ? byId.get(current.parentId) : undefined
    }
    return path
  }, [folderId, folders])
}

/** 某文件夹下的书；`includeDescendants` 为 true 时含子文件夹里的书 */
export function useBooksInFolder(
  folderId: string | null,
  options?: { includeDescendants?: boolean; sort?: SortKey },
) {
  const includeDescendants = options?.includeDescendants ?? false
  const sort = options?.sort ?? 'recent'

  return useLiveQuery(
    async () => {
      if (!db) return []
      const books = await db.books.toArray()

      if (!includeDescendants) {
        return sortBooks(
          books.filter((b) => isInFolder(b, folderId)),
          sort,
        )
      }
      // 根目录的「含子孙」= 全部书籍
      if (folderId === null) return sortBooks(books, sort)

      const folders = await db.folders.toArray()
      const ids = collectFolderIds(folders, folderId)
      return sortBooks(
        books.filter((b) => b.folderId != null && ids.has(b.folderId)),
        sort,
      )
    },
    [folderId, includeDescendants, sort],
    [],
  )
}

/** 全部书籍（跨文件夹）+ 排序（R4「全部书籍」视图用） */
export function useAllBooks(sort: SortKey = 'recent') {
  return useLiveQuery(
    async () => {
      if (!db) return []
      return sortBooks(await db.books.toArray(), sort)
    },
    [sort],
    [],
  )
}

/** 直接子文件夹（按名称排序） */
export function useSubFolders(parentId: string | null) {
  const folders = useFolders()
  return useMemo(
    () =>
      (folders ?? [])
        .filter((f) => (f.parentId ?? null) === parentId)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    [folders, parentId],
  )
}
