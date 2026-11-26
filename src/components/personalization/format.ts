/** 个性化页的文件大小与时间格式，跟随应用语言 */

export const formatFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) {
    return '—'
  }
  if (size < 1024) {
    return `${size} B`
  }
  const kb = size / 1024
  if (kb < 100) {
    return `${kb.toFixed(1)} KB`
  }
  if (kb < 1024) {
    return `${Math.round(kb)} KB`
  }
  return `${(kb / 1024).toFixed(1)} MB`
}

export const formatFileTime = (value: number, locale: string): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '—'
  }
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
