import { IS_SERVER } from '@literal-ui/hooks'
import Dexie, { Table } from 'dexie'

import { PackagingMetadataObject } from '@flow/epubjs/types/packaging'

import { Annotation } from './annotation'
import { fileToEpub } from './file'
import { TypographyConfiguration } from './state'

export interface FileRecord {
  id: string
  file: File
}

export interface CoverRecord {
  id: string
  cover: string | null
}

/**
 * 图书馆文件夹（FlowPlus 新增）
 *
 * 邻接表结构：`parentId` 指向上级文件夹；`null` 表示顶级。
 * 注意：`book.folderId` 必须要么是 `null`、要么指向**存在**的文件夹
 * （删除非空文件夹被禁止，所以不会出现悬空引用）。
 */
export interface FolderRecord {
  id: string
  name: string
  parentId: string | null
  createdAt: number
}

export interface BookRecord {
  // TODO: use file hash as id
  id: string
  name: string
  size: number
  metadata: PackagingMetadataObject
  createdAt: number
  updatedAt?: number
  cfi?: string
  percentage?: number
  definitions: string[]
  annotations: Annotation[]
  configuration?: {
    typography?: TypographyConfiguration
  }
  /**
   * 所属文件夹（FlowPlus 新增）。`null` = 根目录。
   * 迁移会把所有老书显式写成 `null`——因为 IndexedDB 里 `undefined` 不可索引，
   * 否则 `where('folderId').equals(null)` 这类查询会静默漏掉老书。
   */
  folderId?: string | null
}

export class DB extends Dexie {
  // 'books' is added by dexie when declaring the stores()
  // We just tell the typing system this is the case
  files!: Table<FileRecord>
  covers!: Table<CoverRecord>
  books!: Table<BookRecord>
  folders!: Table<FolderRecord>

  constructor(name: string) {
    super(name)

    // v6（FlowPlus）：新增 folders 表，并给 books 加 folderId 索引
    this.version(6)
      .stores({
        books:
          'id, name, size, metadata, createdAt, updatedAt, cfi, percentage, definitions, annotations, configuration, folderId',
        folders: 'id, parentId, name, createdAt',
      })
      .upgrade(async (t) => {
        // ⚠️ 关键：IndexedDB 里 `undefined` 不可被索引，
        // 不写成 null 的话 “根目录” 查询会漏掉所有老书（症状是静默丢书）。
        await t
          .table('books')
          .toCollection()
          .modify((book) => {
            if (book.folderId === undefined) book.folderId = null
          })
      })

    this.version(5).stores({
      books:
        'id, name, size, metadata, createdAt, updatedAt, cfi, percentage, definitions, annotations, configuration',
    })

    this.version(4)
      .stores({
        books:
          'id, name, size, metadata, createdAt, updatedAt, cfi, percentage, definitions, annotations',
      })
      .upgrade(async (t) => {
        t.table('books')
          .toCollection()
          .modify((r) => {
            r.annotations = []
          })
      })

    this.version(3)
      .stores({
        books:
          'id, name, size, metadata, createdAt, updatedAt, cfi, percentage, definitions',
      })
      .upgrade(async (t) => {
        const files = await t.table('files').toArray()

        const metadatas = await Dexie.waitFor(
          Promise.all(
            files.map(async ({ file }) => {
              const epub = await fileToEpub(file)
              return epub.loaded.metadata
            }),
          ),
        )

        return t
          .table('books')
          .toCollection()
          .modify(async (r) => {
            const i = files.findIndex((f) => f.id === r.id)
            r.metadata = metadatas[i]
            r.size = files[i].file.size
          })
          .catch((e) => {
            console.error(e)
            throw e
          })
      })
    this.version(2)
      .stores({
        books: 'id, name, createdAt, cfi, percentage, definitions',
      })
      .upgrade(async (t) => {
        const books = await t.table('books').toArray()
        ;['covers', 'files'].forEach((tableName) => {
          t.table(tableName)
            .toCollection()
            .modify((r) => {
              const book = books.find((b) => b.name === r.id)
              if (book) r.id = book.id
            })
        })
      })
    this.version(1).stores({
      books: 'id, name, createdAt, cfi, percentage, definitions', // Primary key and indexed props
      covers: 'id, cover',
      files: 'id, file',
    })
  }
}

export const db = IS_SERVER ? null : new DB('re-reader')
