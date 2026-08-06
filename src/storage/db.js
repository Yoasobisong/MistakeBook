/**
 * IndexedDB 底层封装 —— 只管读写，不含业务语义。
 *
 * 对象仓：
 *   meta      k/v 配置（ui 状态、settings、备份时间）
 *   books     书籍
 *   chapters  章节（parentId 自嵌套）
 *   problems  题目（images 里只存图片 id 引用）
 *   images    图片 blob（full + thumb）
 *
 * 网页只读版不打开 IndexedDB —— 所有读写函数在 READONLY 下都是空操作，
 * 这样即使有漏网的写调用也不会炸。
 */
import { READONLY } from '../core/env.js'

const DB_NAME = 'CuotibenDB'
const DB_VER = 1

let DB = null

export const isOpen = () => !!DB

export function openDB () {
  return new Promise((res, rej) => {
    let r
    try { r = indexedDB.open(DB_NAME, DB_VER) } catch (e) { return rej(e) }

    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' })
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('chapters')) {
        db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('book', 'bookId')
      }
      if (!db.objectStoreNames.contains('problems')) {
        db.createObjectStore('problems', { keyPath: 'id' }).createIndex('book', 'bookId')
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' })
    }

    r.onsuccess = () => { DB = r.result; res(DB) }
    r.onerror = () => rej(r.error || new Error('indexedDB open failed'))
    r.onblocked = () => rej(new Error('数据库被其他标签页占用，请关闭其它错题本窗口'))
  })
}

const store = (s, mode) => DB.transaction(s, mode).objectStore(s)
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

/* READONLY 下全部空操作：网页版根本不打开数据库 */
const noopRes = v => Promise.resolve(v)

export const dbGet = (s, k) => READONLY ? noopRes(null) : req(store(s, 'readonly').get(k))
export const dbAll = s => READONLY ? noopRes([]) : req(store(s, 'readonly').getAll())
export const dbPut = (s, v) => READONLY ? noopRes(null) : req(store(s, 'readwrite').put(v))
export const dbDel = (s, k) => READONLY ? noopRes(null) : req(store(s, 'readwrite').delete(k))

export function dbPutMany (s, arr) {
  if (READONLY || !arr || !arr.length) return Promise.resolve()
  const t = DB.transaction(s, 'readwrite')
  const st = t.objectStore(s)
  arr.forEach(v => st.put(v))
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error) })
}

export function dbDelMany (s, keys) {
  if (READONLY || !keys || !keys.length) return Promise.resolve()
  const t = DB.transaction(s, 'readwrite')
  const st = t.objectStore(s)
  keys.forEach(k => st.delete(k))
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error) })
}
