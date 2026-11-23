import { useEffect, useState } from 'react'
import { getFileViewType, isImage } from '../../services/attachments.js'
import { loadFile } from '../../services/chat/db.js'

const createViewUrl = (original: Blob, type: string) => {
  const blob = original.slice(0, original.size, type || 'application/octet-stream')
  if (type !== 'image/svg+xml') {
    return URL.createObjectURL(blob)
  }
  // SVG 缩略图用 data: 地址，单独打开图片时也与应用隔离。
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

type ViewState = {
  source: File | string
  type: string
  url: string | null
  blob: Blob | null
}

/** 草稿传 File，已发送的附件传 IndexedDB 原件 ID。 */
export const useFileView = (source: File | string, name: string) => {
  const type = getFileViewType(name)
  const [state, setState] = useState<ViewState>()
  useEffect(() => {
    let active = true
    const original = typeof source === 'string' ? loadFile(source) : Promise.resolve(source)
    const pending = original
      .then(async (blob) => {
        if (!active || !blob) {
          return null
        }
        return { blob, url: await createViewUrl(blob, type) }
      })
      .catch(() => null)
    void pending.then((result) => {
      if (active) {
        setState({
          source,
          type,
          url: result?.url ?? null,
          blob: result?.blob ?? null,
        })
      }
    })
    return () => {
      active = false
      void pending.then((result) => {
        if (result?.url.startsWith('blob:')) {
          URL.revokeObjectURL(result.url)
        }
      })
    }
  }, [source, type])

  const current = state?.source === source && state.type === type ? state : undefined
  return {
    url: current?.url,
    blob: current?.blob ?? null,
    image: isImage(type),
    type,
  }
}
