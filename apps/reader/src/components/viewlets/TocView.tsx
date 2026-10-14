import { useMemo, useState } from 'react'
import { MdAdd } from 'react-icons/md'
import { VscCollapseAll, VscExpandAll } from 'react-icons/vsc'

import { BookRecord } from '@flow/reader/db'
import {
  useAllBooks,
  useFolders,
  useList,
  useMobile,
  useTranslation,
} from '@flow/reader/hooks'
import {
  buildFolderTree,
  createFolder,
  deleteFolder,
  FolderNode,
  moveBook,
  moveFolder,
  renameFolder,
} from '@flow/reader/library'
import {
  compareHref,
  dfs,
  flatTree,
  INavItem,
  reader,
  useReaderSnapshot,
} from '@flow/reader/models'
import { useLibraryView, useSort } from '@flow/reader/state'

import { Row } from '../Row'
import { PaneViewProps, PaneView, Pane } from '../base'

export const TocView: React.FC<PaneViewProps> = (props) => {
  const mobile = useMobile()
  return (
    <PaneView {...props}>
      {mobile || <LibraryPane />}
      <TocPane />
    </PaneView>
  )
}

/** 侧栏一行的类型：虚拟「全部书籍」/ 文件夹 / 书 */
type LibraryRow =
  | { kind: 'all'; id: string; name: string; depth: number; count: number }
  | {
      kind: 'folder'
      id: string
      name: string
      depth: number
      count: number
      expanded: boolean
      hasChildren: boolean
    }
  | { kind: 'book'; id: string; name: string; depth: number; book: BookRecord }

const ALL_BOOKS_ID = '__all__'

/** 拖拽时给“文件夹”用的自定义 MIME，便于与书（text/plain）区分 */
const FOLDER_DND = 'application/x-flowplus-folder'

/**
 * 侧栏「图书馆」：文件夹树
 *
 * 结构（R1/R3）：
 *   全部书籍                ← 虚拟节点（R4）
 *   ▾ 文件夹A
 *       ▸ 子文件夹
 *       书…
 *   书…（根目录）
 *
 * 每一步只做只读部分：展开/折叠、切换当前文件夹、打开书。
 * 新建/重命名/删除/拖拽移动属于 Phase 8 第 5 步。
 */
const LibraryPane: React.FC = () => {
  const t = useTranslation('toc')
  const [view, setView] = useLibraryView()
  const [sort] = useSort()
  const folders = useFolders()
  const books = useAllBooks(sort)
  // 只记录「被显式折叠」的文件夹，默认全部展开
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  /** 当前所在文件夹（null = 顶级 / 全部书籍） */
  const currentFolderId = view.type === 'folder' ? view.id : null

  /* ---------- 文件夹写操作（新建 / 重命名 / 删除 / 移动） ---------- */

  const newFolder = async () => {
    const name = window.prompt(t('library.new_folder'), '新建文件夹')
    if (name === null) return // 取消
    // 建在“当前所在的文件夹”里；在全部书籍/根目录下就是顶级
    const created = await createFolder(name, currentFolderId)
    if (currentFolderId === null) setView({ type: 'folder', id: created.id })
  }

  const renameFolderFlow = async (id: string, current: string) => {
    const name = window.prompt(t('library.rename_folder'), current)
    if (name === null || name === current) return
    await renameFolder(id, name)
  }

  /**
   * 删除文件夹。
   * R2：**禁止删除非空文件夹** —— 先看子项数，非空直接提示“请先移出内容”，
   * 不会弹一个“然后又失败”的确认框。
   */
  const deleteFolderFlow = async (id: string, name: string, count: number) => {
    if (count > 0) {
      window.alert(t('library.folder_not_empty'))
      return
    }
    if (!window.confirm(`${t('library.delete_folder')}「${name}」？`)) return

    await deleteFolder(id)
    // 若当前正停在这个文件夹里，退回全部书籍
    if (view.type === 'folder' && view.id === id) setView({ type: 'all' })
  }

  const moveFolderFlow = async (id: string, parentId: string | null) => {
    try {
      await moveFolder(id, parentId)
    } catch (e) {
      // 移动到自身 / 自己的子孙下会被拒绝
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const rows = useMemo<LibraryRow[]>(() => {
    // 一次取回全部书，在内存里按文件夹分组（避免为每个文件夹单独查一次）
    const byFolder = new Map<string | null, BookRecord[]>()
    for (const book of books) {
      const key = book.folderId ?? null
      const list = byFolder.get(key)
      if (list) list.push(book)
      else byFolder.set(key, [book])
    }

    const out: LibraryRow[] = [
      {
        kind: 'all',
        id: ALL_BOOKS_ID,
        name: t('library.all'),
        depth: 0,
        count: books.length,
      },
    ]

    const walk = (nodes: FolderNode[], depth: number) => {
      for (const node of nodes) {
        const booksHere = byFolder.get(node.id) ?? []
        const isCollapsed = !!collapsed[node.id]
        const hasChildren = node.subitems.length > 0 || booksHere.length > 0
        out.push({
          kind: 'folder',
          id: node.id,
          name: node.name,
          depth,
          count: node.subitems.length + booksHere.length,
          expanded: !isCollapsed,
          hasChildren,
        })
        if (isCollapsed) continue
        walk(node.subitems, depth + 1) // 先子文件夹，再本层的书（与 R3 一致）
        for (const book of booksHere) {
          out.push({
            kind: 'book',
            id: book.id,
            name: book.name,
            depth: depth + 1,
            book,
          })
        }
      }
    }
    walk(buildFolderTree(folders ?? []), 0)

    for (const book of byFolder.get(null) ?? []) {
      out.push({
        kind: 'book',
        id: book.id,
        name: book.name,
        depth: 0,
        book,
      })
    }

    return out
  }, [books, collapsed, folders, t])

  return (
    <Pane
      headline={t('library')}
      preferredSize={240}
      actions={[
        {
          id: 'new-folder',
          title: t('library.new_folder'),
          Icon: MdAdd,
          handle() {
            void newFolder()
          },
        },
      ]}
    >
      {rows.map((row) => {
        const active =
          (row.kind === 'all' && view.type === 'all') ||
          (row.kind === 'folder' &&
            view.type === 'folder' &&
            view.id === row.id)

        return (
          <Row
            key={`${row.kind}:${row.id}`}
            title={row.name}
            depth={row.depth}
            active={active}
            description={
              row.kind === 'book' || !row.count ? undefined : row.count
            }
            expanded={row.kind === 'folder' ? row.expanded : undefined}
            hasChildren={row.kind === 'folder' && row.hasChildren}
            onClick={() => {
              if (row.kind === 'book') reader.addTab(row.book)
              else if (row.kind === 'all') setView({ type: 'all' })
              else setView({ type: 'folder', id: row.id })
            }}
            toggle={() => {
              if (row.kind !== 'folder') return
              setCollapsed((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
            }}
            {...(row.kind === 'book'
              ? {
                  draggable: true,
                  onDragStart: (e: React.DragEvent) => {
                    e.dataTransfer.setData('text/plain', row.book.id)
                  },
                }
              : {
                  // 文件夹行：可拖动（移动文件夹）与双击重命名，
                  // 悬浮时右侧出现 ✕ 用于删除（Row 自带的 onDelete）
                  ...(row.kind === 'folder'
                    ? {
                        draggable: true,
                        onDragStart: (e: React.DragEvent) => {
                          e.dataTransfer.setData(FOLDER_DND, row.id)
                        },
                        onDoubleClick: () => {
                          void renameFolderFlow(row.id, row.name)
                        },
                        onDelete: () => {
                          void deleteFolderFlow(row.id, row.name, row.count)
                        },
                      }
                    : {}),
                  // 文件夹行与「全部书籍」行都能接收：书（text/plain）与文件夹
                  // （拖书到「全部书籍」= 移出到根目录）
                  onDragOver: (e: React.DragEvent) => {
                    const types = e.dataTransfer.types
                    if (
                      !types.includes('text/plain') &&
                      !types.includes(FOLDER_DND)
                    )
                      return
                    e.preventDefault()
                  },
                  onDrop: (e: React.DragEvent) => {
                    const bookId = e.dataTransfer.getData('text/plain')
                    const folderId = e.dataTransfer.getData(FOLDER_DND)
                    if (!bookId && !folderId) return
                    e.preventDefault()
                    e.stopPropagation()

                    const target = row.kind === 'all' ? null : row.id
                    if (bookId) void moveBook(bookId, target)
                    else if (folderId) void moveFolderFlow(folderId, target)
                  },
                })}
          />
        )
      })}
    </Pane>
  )
}

const TocPane: React.FC = () => {
  const t = useTranslation()
  const { focusedBookTab } = useReaderSnapshot()
  const toc = focusedBookTab?.nav?.toc as INavItem[] | undefined
  const rows = useMemo(() => toc?.flatMap((i) => flatTree(i)), [toc])
  const expanded = toc?.some((r) => r.expanded)
  const currentNavItem = focusedBookTab?.currentNavItem

  const { outerRef, innerRef, items, scrollToItem } = useList(rows)

  return (
    <Pane
      headline={t('toc.title')}
      ref={outerRef}
      actions={[
        {
          id: expanded ? 'collapse-all' : 'expand-all',
          title: t(expanded ? 'action.collapse_all' : 'action.expand_all'),
          Icon: expanded ? VscCollapseAll : VscExpandAll,
          handle() {
            reader.focusedBookTab?.nav?.toc?.forEach((r) =>
              dfs(r as INavItem, (i) => (i.expanded = !expanded)),
            )
          },
        },
      ]}
    >
      {rows && (
        <div ref={innerRef}>
          {items.map(({ index }) => (
            <TocRow
              key={index}
              currentNavItem={currentNavItem as INavItem}
              item={rows[index]}
              onActivate={() => scrollToItem(index)}
            />
          ))}
        </div>
      )}
    </Pane>
  )
}

interface TocRowProps {
  currentNavItem?: INavItem
  item?: INavItem
  onActivate: () => void
}
const TocRow: React.FC<TocRowProps> = ({
  currentNavItem,
  item,
  onActivate,
}) => {
  if (!item) return null
  const { label, subitems, depth, expanded, id, href } = item
  const tab = reader.focusedBookTab

  return (
    <Row
      title={label.trim()}
      depth={depth}
      active={href === currentNavItem?.href}
      expanded={expanded}
      subitems={subitems}
      onClick={() => {
        const [, id] = href.split('#')
        const section = tab?.sections?.find((s) => compareHref(s.href, href))

        if (!section) return

        if (id) {
          tab?.displayFromSelector(`#${id}`, section, false)
        } else {
          tab?.display(section.href, false)
        }
      }}
      // `tab` can not be proxy here
      toggle={() => tab?.toggle(id)}
      onActivate={onActivate}
    />
  )
}
