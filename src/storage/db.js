/**
 * IndexedDB 底层封装 —— 只管读写，不含业务语义。
 *
 * 对象仓：
 *   meta      k/v 配置（ui 状态、settings、备份时间）
 *   books     书籍
 *   chapters  章节（parentId 自嵌套）
 *   problems  题目（images 里只存图片 id 引用）
 *   images    图片 blob（full + thumb）
 */

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

export const dbGet = (s, k) => req(store(s, 'readonly').get(k))
export const dbAll = s => req(store(s, 'readonly').getAll())
export const dbPut = (s, v) => req(store(s, 'readwrite').put(v))
export const dbDel = (s, k) => req(store(s, 'readwrite').delete(k))

export function dbPutMany (s, arr) {
  if (!arr || !arr.length) return Promise.resolve()
  const t = DB.transaction(s, 'readwrite')
  const st = t.objectStore(s)
  arr.forEach(v => st.put(v))
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error) })
}

export function dbDelMany (s, keys) {
  if (!keys || !keys.length) return Promise.resolve()
  const t = DB.transaction(s, 'readwrite')
  const st = t.objectStore(s)
  keys.forEach(k => st.delete(k))
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error) })
}
