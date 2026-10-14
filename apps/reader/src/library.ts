import { v4 as uuidv4 } from 'uuid'

import { BookRecord, FolderRecord, db } from './db'
import { SortKey } from './state'

/**
 * FlowPlus：图书馆领域逻辑（Phase 8）
 *
 * 这里只有两件事：
 *   1. 纯函数（排序 / 过滤 / 建树 / 收集子树）—— 不碰 DOM，便于复用在侧栏与主区
 *   2. 写操作（新建 / 重命名 / 移动 / 删除文件夹，移动书籍）—— 集中在一处，规则好审计
 *
 * 数据模型见 `db.ts`：`folders.parentId` 为邻接表；`books.folderId === null` 表示根目录。
 * 必须维持的不变量：
 *   - `book.folderId` 要么是 null、要么指向**存在**的文件夹
 *   - 文件夹不能移动到自身或自己的子孙下（否则成环）
 */

/** 中文友好的文件名排序：数字按数值比较（"第2卷" 排在 "第10卷" 之前） */
const collator = new Intl.Collator('zh-Hans', {
  numeric: true,
  sensitivity: 'base',
})

export function compareName(a: string, b: string) {
  return collator.compare(a, b)
}

/** 根目录 = `folderId` 为 null 或 undefined（旧数据兜底） */
export function isInFolder(book: BookRecord, folderId: string | null) {
  return (book.folderId ?? null) === folderId
}

/** 排序（R5）：`recent` 按 updatedAt 降序，`name` 按文件名 */
export function sortBooks(books: BookRecord[], sort: SortKey = 'recent') {
  const copy = [...books]
  if (sort === 'name') {
    copy.sort((a, b) => compareName(a.name, b.name))
  } else {
    // updatedAt 由 reader.updateBook() 在阅读/标注/词典写入时刷新
    copy.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }
  return copy
}

/** 某文件夹整棵子树（含自身）的 id 集合；迭代式实现，脏数据成环也不会死循环 */
export function collectFolderIds(folders: FolderRecord[], rootId: string) {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (
        folder.parentId !== null &&
        ids.has(folder.parentId) &&
        !ids.has(folder.id)
      ) {
        ids.add(folder.id)
        changed = true
      }
    }
  }
  return ids
}

export interface FolderNode extends FolderRecord {
  subitems: FolderNode[]
}

/** 扁平化的文件夹（带深度），供下拉选项 / 缩进渲染使用 */
export interface FlatFolder {
  id: string
  name: string
  depth: number
}

export function flattenFolderTree(
  nodes: FolderNode[],
  depth = 0,
): FlatFolder[] {
  const out: FlatFolder[] = []
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth })
    out.push(...flattenFolderTree(node.subitems, depth + 1))
  }
  return out
}

/**
 * 把扁平文件夹列表组装成树，返回**顶级节点数组**。
 * 脏数据兜底：`parentId` 指向不存在的文件夹时，该节点按顶级处理（不会凭空消失）。
 */
export function buildFolderTree(folders: FolderRecord[]) {
  const byId = new Map<string, FolderNode>()
  for (const folder of folders) {
    byId.set(folder.id, { ...folder, subitems: [] })
  }

  const roots: FolderNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId !== null ? byId.get(node.parentId) : undefined
    if (parent) parent.subitems.push(node)
    else roots.push(node)
  }

  const sortRecursive = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => compareName(a.name, b.name))
    nodes.forEach((n) => sortRecursive(n.subitems))
  }
  sortRecursive(roots)

  return roots
}

/** 名称去空白；空名给一个默认值（避免出现看不见的行） */
function normalizeName(name: string) {
  return name.trim() || '新建文件夹'
}

/* ------------------------------------------------------------------ *
 * 写操作
 * ------------------------------------------------------------------ */

export async function createFolder(
  name: string,
  parentId: string | null = null,
) {
  const folder: FolderRecord = {
    id: uuidv4(),
    name: normalizeName(name),
    parentId,
    createdAt: Date.now(),
  }
  await db?.folders.add(folder)
  return folder
}

export async function renameFolder(id: string, name: string) {
  await db?.folders.update(id, { name: normalizeName(name) })
}

/** 文件夹不能移动到自身或自己的子孙下（防环） */
export async function moveFolder(id: string, parentId: string | null) {
  if (id === parentId) throw new Error('不能移动到自身')

  if (parentId !== null) {
    const folders = (await db?.folders.toArray()) ?? []
    if (!folders.some((f) => f.id === parentId)) {
      throw new Error('目标文件夹不存在')
    }
    if (collectFolderIds(folders, id).has(parentId)) {
      throw new Error('不能移动到自己的子文件夹里')
    }
  }

  await db?.folders.update(id, { parentId })
}

/**
 * 删除文件夹。
 * R2 规则：**禁止删除非空文件夹**（含子文件夹或其中的书），提示先移出内容。
 */
export async function deleteFolder(id: string) {
  const childFolders =
    (await db?.folders.where('parentId').equals(id).count()) ?? 0
  const childBooks = (await db?.books.where('folderId').equals(id).count()) ?? 0

  if (childFolders > 0 || childBooks > 0) {
    throw new Error('文件夹非空，请先移出内容')
  }
  await db?.folders.delete(id)
}

/** 把书移到某个文件夹（null = 根目录） */
export async function moveBook(bookId: string, folderId: string | null) {
  await db?.books.update(bookId, { folderId })
}
