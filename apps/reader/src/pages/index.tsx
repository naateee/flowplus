import { useBoolean } from '@literal-ui/hooks'
import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useEffect, useMemo, useState } from 'react'
import {
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdFolder,
  MdOutlineFileDownload,
} from 'react-icons/md'
import { useSet } from 'react-use'

import { pack } from '../backup'
import {
  ReaderGridView,
  Button,
  Select,
  TextField,
  DropZone,
} from '../components'
import { BookRecord, CoverRecord, db } from '../db'
import { fetchBook, handleFiles } from '../file'
import {
  useAllBooks,
  useDisablePinchZooming,
  useFolderPath,
  useFolders,
  useMobile,
  useSubFolders,
  useTranslation,
} from '../hooks'
import { buildFolderTree, flattenFolderTree, moveBook } from '../library'
import { reader, useReaderSnapshot } from '../models'
import { SortKey, useLibraryView, useSearch, useSort } from '../state'
import { lock } from '../styles'

const placeholder = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="gray" fill-opacity="0" width="1" height="1"/></svg>`

const SOURCE = 'src'

export default function Index() {
  const { focusedTab } = useReaderSnapshot()
  const router = useRouter()
  const src = new URL(window.location.href).searchParams.get(SOURCE)
  const [loading, setLoading] = useState(!!src)

  useDisablePinchZooming()

  useEffect(() => {
    let src = router.query[SOURCE]
    if (!src) return
    if (!Array.isArray(src)) src = [src]

    Promise.all(
      src.map((s) =>
        fetchBook(s).then((b) => {
          reader.addTab(b)
        }),
      ),
    ).finally(() => setLoading(false))
  }, [router.query])

  useEffect(() => {
    if ('launchQueue' in window && 'LaunchParams' in window) {
      window.launchQueue.setConsumer((params) => {
        console.log('launchQueue', params)
        if (params.files.length) {
          Promise.all(params.files.map((f) => f.getFile()))
            .then((files) => handleFiles(files))
            .then((books) => books.forEach((b) => reader.addTab(b)))
        }
      })
    }
  }, [])

  useEffect(() => {
    router.beforePopState(({ url }) => {
      if (url === '/') {
        reader.clear()
      }
      return true
    })
  }, [router])

  return (
    <>
      <Head>
        {/* https://github.com/microsoft/vscode/blob/36fdf6b697cba431beb6e391b5a8c5f3606975a1/src/vs/code/browser/workbench/workbench.html#L16 */}
        {/* Disable pinch zooming */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no"
        />
        <title>{focusedTab?.title ?? 'FlowPlus'}</title>
      </Head>
      <ReaderGridView />
      {loading || <Library />}
    </>
  )
}

const Library: React.FC = () => {
  const covers = useLiveQuery(() => db?.covers.toArray() ?? [])
  const t = useTranslation('home')

  // 当前视图：全部书籍 / 某个文件夹（供侧栏与主区共享）
  const [view, setView] = useLibraryView()
  const [sort, setSort] = useSort()
  const [search, setSearch] = useSearch()

  const allBooks = useAllBooks(sort)
  const folders = useFolders()
  const folderId = view.type === 'folder' ? view.id : null
  const subFolders = useSubFolders(folderId)
  const path = useFolderPath(folderId)

  // 搜索时跨文件夹；否则按当前文件夹过滤（文件夹视图只看本层，子文件夹以磁贴呈现）
  const keyword = search.trim().toLowerCase()
  const books = useMemo(() => {
    if (keyword) {
      return allBooks.filter((b) => b.name.toLowerCase().includes(keyword))
    }
    if (view.type === 'all') return allBooks
    return allBooks.filter((b) => (b.folderId ?? null) === view.id)
  }, [allBooks, keyword, view])

  // 文件夹磁贴上的子项数（子文件夹 + 本层的书）
  const childCount = (id: string) =>
    (folders ?? []).filter((f) => (f.parentId ?? null) === id).length +
    allBooks.filter((b) => (b.folderId ?? null) === id).length

  // 「移动到…」下拉的选项（带缩进以体现层级）
  const folderOptions = useMemo(
    () => flattenFolderTree(buildFolderTree(folders ?? [])),
    [folders],
  )

  /** 把选中的书批量移动到目标位置（null = 根目录） */
  const moveSelectedBooks = async (targetId: string | null) => {
    const bookIds = [...selectedBookIds]
    if (!bookIds.length) return
    await Promise.all(bookIds.map((id) => moveBook(id, targetId)))
    toggleSelect()
  }

  const [select, toggleSelect] = useBoolean(false)
  const [selectedBookIds, { add, has, toggle, reset }] = useSet<string>()

  const { groups } = useReaderSnapshot()

  useEffect(() => {
    if (!select) reset()
  }, [reset, select])

  if (groups.length) return null

  const allSelected = selectedBookIds.size === books.length

  return (
    <DropZone
      className="scroll-parent h-full p-4"
      onDrop={(e) => {
        const bookId = e.dataTransfer.getData('text/plain')
        // 拖动可能来自侧栏的任意文件夹，所以要在全量里找
        const book = allBooks.find((b) => b.id === bookId)
        if (book) reader.addTab(book)

        // 拖进来的 epub 落到当前文件夹
        handleFiles(e.dataTransfer.files, folderId)
      }}
    >
      <div className="mb-4 space-y-2.5">
        <div>
          <TextField
            name={SOURCE}
            placeholder="https://link.to/remote.epub"
            type="url"
            hideLabel
            actions={[
              {
                title: t('download'),
                Icon: MdOutlineFileDownload,
                onClick(el) {
                  if (el?.reportValidity()) fetchBook(el.value, folderId)
                },
              },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          {/* 面包屑：图书馆 / 文件夹…（可点击跳转） */}
          <div className="text-on-surface-variant flex min-w-0 items-center gap-1 text-sm">
            <button
              className="hover:text-on-surface shrink-0"
              onClick={() => setView({ type: 'all' })}
            >
              {t('all_books')}
            </button>
            {view.type === 'folder' &&
              path.map((folder) => (
                <React.Fragment key={folder.id}>
                  <span className="text-outline shrink-0">/</span>
                  <button
                    className="hover:text-on-surface truncate"
                    title={folder.name}
                    onClick={() => setView({ type: 'folder', id: folder.id })}
                  >
                    {folder.name}
                  </button>
                </React.Fragment>
              ))}
            {keyword && (
              <span className="text-outline ml-2 shrink-0">
                · {books.length}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="recent">{t('sort.recent')}</option>
              <option value="name">{t('sort.name')}</option>
            </Select>
            <div className="w-40">
              <TextField
                name="search"
                placeholder={t('search')}
                hideLabel
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearch(e.target.value)
                }
                onClear={() => setSearch('')}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-x-2">
            {books.length ? (
              <Button variant="secondary" onClick={toggleSelect}>
                {t(select ? 'cancel' : 'select')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={!books}
                onClick={() => {
                  fetchBook(
                    'https://epubtest.org/books/Fundamental-Accessibility-Tests-Basic-Functionality-v1.0.0.epub',
                    folderId,
                  )
                }}
              >
                {t('download_sample_book')}
              </Button>
            )}
            {select &&
              (allSelected ? (
                <Button variant="secondary" onClick={reset}>
                  {t('deselect_all')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => books.forEach((b) => add(b.id))}
                >
                  {t('select_all')}
                </Button>
              ))}
          </div>

          <div className="space-x-2">
            {select ? (
              <>
                <Select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    moveSelectedBooks(v === '__root__' ? null : v)
                  }}
                >
                  <option value="">{t('move_to')}</option>
                  <option value="__root__">{t('move_to_root')}</option>
                  {folderOptions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {'\u3000'.repeat(f.depth + 1)}
                      {f.name}
                    </option>
                  ))}
                </Select>
                <Button
                  onClick={async () => {
                    const bookIds = [...selectedBookIds]

                    // FlowPlus：删除是不可撤销的，加一道确认
                    // （之前就吃过一次亏：选完直接删，一点就会消失）
                    const ok = window.confirm(
                      `确定要删除选中的 ${bookIds.length} 本书吗？\n\n这会同时删除它们的封面与本地 epub 文件，且无法撤销。`,
                    )
                    if (!ok) return

                    toggleSelect()
                    db?.books.bulkDelete(bookIds)
                    db?.covers.bulkDelete(bookIds)
                    db?.files.bulkDelete(bookIds)
                  }}
                >
                  {t('delete')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  disabled={!books.length}
                  onClick={pack}
                >
                  {t('export')}
                </Button>
                <Button className="relative">
                  <input
                    type="file"
                    accept="application/epub+zip,application/epub,application/zip"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={(e) => {
                      const files = e.target.files
                      if (files) handleFiles(files, folderId)
                    }}
                    multiple
                  />
                  {t('import')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="scroll h-full">
        <ul
          className="grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(calc(80px + 3vw), 1fr))`,
            columnGap: lock(16, 32),
            rowGap: lock(24, 40),
          }}
        >
          {!keyword &&
            subFolders.map((folder) => (
              <FolderTile
                key={folder.id}
                name={folder.name}
                count={childCount(folder.id)}
                onClick={() => setView({ type: 'folder', id: folder.id })}
                onDropBook={(bookId) => moveBook(bookId, folder.id)}
              />
            ))}
          {books.map((book) => (
            <Book
              key={book.id}
              book={book}
              covers={covers}
              select={select}
              selected={has(book.id)}
              toggle={toggle}
            />
          ))}
        </ul>
        {!books.length && (keyword || !subFolders.length) && (
          <div className="text-outline p-8 text-center text-sm">
            {keyword ? t('no_match') : t('empty_folder')}
          </div>
        )}{' '}
      </div>
    </DropZone>
  )
}

interface BookProps {
  book: BookRecord
  covers?: CoverRecord[]
  select?: boolean
  selected?: boolean
  toggle: (id: string) => void
}
const Book: React.FC<BookProps> = ({
  book,
  covers,
  select,
  selected,
  toggle,
}) => {
  const router = useRouter()
  const mobile = useMobile()

  const cover = covers?.find((c) => c.id === book.id)?.cover

  const Icon = selected ? MdCheckBox : MdCheckBoxOutlineBlank

  return (
    <div className="relative flex flex-col">
      <div
        role="button"
        className="border-inverse-on-surface relative border"
        onClick={async () => {
          if (select) {
            toggle(book.id)
          } else {
            if (mobile) await router.push('/_')
            reader.addTab(book)
          }
        }}
      >
        {book.percentage !== undefined && (
          <div className="typescale-body-large absolute right-0 bg-gray-500/60 px-2 text-gray-100">
            {(book.percentage * 100).toFixed()}%
          </div>
        )}
        <img
          src={cover ?? placeholder}
          alt="Cover"
          className="mx-auto aspect-[9/12] object-cover"
          draggable={false}
        />
        {select && (
          <div className="absolute bottom-1 right-1">
            <Icon
              size={24}
              className={clsx(
                '-m-1',
                selected ? 'text-tertiary' : 'text-outline',
              )}
            />
          </div>
        )}
      </div>

      <div
        className="line-clamp-2 text-on-surface-variant typescale-body-small lg:typescale-body-medium mt-2 w-full"
        title={book.name}
      >
        {book.name}
      </div>
    </div>
  )
}

interface FolderTileProps {
  name: string
  count: number
  onClick: () => void
  /** 把书拖进这个文件夹 */
  onDropBook?: (bookId: string) => void
}
/** 主区里代表文件夹的磁贴；与书卡片同尺寸，排在书前面（R3） */
const FolderTile: React.FC<FolderTileProps> = ({
  name,
  count,
  onClick,
  onDropBook,
}) => {
  const [over, setOver] = useState(false)
  return (
    <div
      role="button"
      className={clsx(
        'group relative flex cursor-pointer flex-col rounded-sm transition',
        over && 'bg-tertiary-container/40',
      )}
      title={name}
      onClick={onClick}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/plain')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const bookId = e.dataTransfer.getData('text/plain')
        setOver(false)
        if (!bookId || !onDropBook) return // 文件拖放交给外层 DropZone 处理
        e.preventDefault()
        e.stopPropagation()
        onDropBook(bookId)
      }}
    >
      <div
        className="border-inverse-on-surface bg-surface-variant/40 flex items-center justify-center border"
        style={{ aspectRatio: '9 / 12' }}
      >
        <MdFolder size={48} className="text-outline" />
      </div>
      <div
        className="line-clamp-2 text-on-surface-variant typescale-body-small lg:typescale-body-medium mt-2 w-full"
        title={name}
      >
        <MdFolder className="mr-1 mb-0.5 inline" size={16} />
        {name}
        {count > 0 && <span className="text-outline ml-1">{count}</span>}
      </div>
    </div>
  )
}
