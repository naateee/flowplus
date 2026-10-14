// FlowPlus：本地备份导出/导入
//
// 本文件从上游的 `src/sync.ts` 拆出。
// 上游把「本地 zip 备份」与「Dropbox 云同步」混在同一个文件里，
// 这里只保留与云无关的部分：pack()（导出）/ unpack()（导入恢复）。
// 云同步、Dropbox OAuth、远程上传/下载均已在 FlowPlus 中移除。

import { saveAs } from 'file-saver'
import JSZip from 'jszip'

import { BookRecord, db, FolderRecord } from './db'

interface SerializedBooks {
  version: number
  dbVersion: number
  books: BookRecord[]
}

const VERSION = 1
export const DATA_FILENAME = 'data.json'

function serializeData(books?: BookRecord[]) {
  return JSON.stringify({
    version: VERSION,
    dbVersion: db?.verno,
    books,
  })
}

function deserializeData(text: string) {
  const { version, dbVersion, books } = JSON.parse(text) as SerializedBooks

  if (version < VERSION) {
    // migrate `data.json`
  }
  if (db && dbVersion < db.verno) {
    // migrate `BookRecord`
  }

  return books
}

/**
 * 导出完整备份：data.json（元数据/进度/标注/所属文件夹）+ covers.json
 * + folders.json（文件夹树，FlowPlus 新增）+ files/<每本 epub>
 * 文件名形如 `flow_backup_YYYYMMDD.zip`
 */
export async function pack() {
  const books = await db?.books.toArray()
  const covers = await db?.covers.toArray()
  const files = await db?.files.toArray()
  const folders = await db?.folders.toArray()

  const zip = new JSZip()
  zip.file(DATA_FILENAME, serializeData(books))
  zip.file('covers.json', JSON.stringify(covers))
  // 文件夹树单独一个文件：旧版本的 FlowPlus 不认它（会忽略）——即向后兼容 =
  zip.file('folders.json', JSON.stringify(folders ?? []))

  const folder = zip.folder('files')
  files?.forEach((f) => folder?.file(f.file.name, f.file))

  const date = new Intl.DateTimeFormat('fr-CA').format().replaceAll('-', '')

  return zip.generateAsync({ type: 'blob' }).then((content) => {
    saveAs(content, `flow_backup_${date}.zip`)
  })
}

/** 从 pack() 产出的 zip 恢复书库（同时尽量兼容旧格式） */
export async function unpack(file: File) {
  const zip = new JSZip()
  await zip.loadAsync(file)

  const booksJSON = zip.file(DATA_FILENAME)
  const coversJSON = zip.file('covers.json')
  if (!booksJSON || !coversJSON) return

  const books = deserializeData(await booksJSON.async('text'))

  // 1) 先写文件夹（书要引用它们）
  //    旧备份没有 folders.json → 跳过，不会影响已有文件夹
  const foldersJSON = zip.file('folders.json')
  if (foldersJSON && db) {
    const folders = JSON.parse(
      await foldersJSON.async('text'),
    ) as FolderRecord[]
    if (folders.length) await db.folders.bulkPut(folders)
  }

  // 2) 再写书。
  //    旧备份的书没有 folderId 字段：此时**保留当前已有的归档**，
  //    不要因为“恢复了一份旧备份”就把所有书从文件夹里抹出去。
  if (db) {
    const existing = await db.books.bulkGet(books.map((b) => b.id))
    const merged = books.map((book, i) => ({
      ...book,
      folderId:
        book.folderId === undefined
          ? existing[i]?.folderId ?? null
          : book.folderId,
    }))
    await db.books.bulkPut(merged)
  }

  const coversText = await coversJSON.async('text')
  db?.covers.bulkPut(JSON.parse(coversText))

  const folder = zip.folder('files')
  folder?.forEach(async (_, f) => {
    const book = books.find((b) => `files/${b.name}` === f.name)
    if (!book) return

    const data = await f.async('blob')
    const file = new File([data], book.name)
    db?.files.put({ file, id: book.id })
  })
}
