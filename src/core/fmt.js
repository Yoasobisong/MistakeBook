/** 日期、数字、体积的格式化 */

export const pad = (n, w) => String(n).padStart(w || 3, '0')

const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2)

export const today = () => ymd(new Date())
export const fmtD = ts => ymd(new Date(ts))
export const fmtDT = ts => {
  const d = new Date(ts)
  return ymd(d) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2)
}

export const bytes = n =>
  n < 1024 ? n + ' B'
    : n < 1048576 ? (n / 1024).toFixed(0) + ' KB'
      : (n / 1048576).toFixed(1) + ' MB'

export function ago (ts) {
  const d = Math.floor((Date.now() - ts) / 86400000)
  return d <= 0 ? '今天'
    : d === 1 ? '昨天'
      : d < 30 ? d + ' 天前'
        : d < 365 ? Math.floor(d / 30) + ' 个月前'
          : Math.floor(d / 365) + ' 年前'
}
