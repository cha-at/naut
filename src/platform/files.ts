import { isAndroid, isTauri } from './env.js'

export type SaveBlobResult =
  | { status: 'saved' }
  | { status: 'canceled' }
  | { status: 'failed'; error?: unknown }

const FILE_FILTERS = [
  { name: 'ZIP', extensions: ['zip'] },
  { name: 'ZIP archive', extensions: ['application/zip', 'application/x-zip-compressed'] },
]

const fileNameFromPath = (path: string, fallback = 'history.zip'): string => {
  const segment = path.split(/[\\/]/).pop() ?? ''
  try {
    return decodeURIComponent(segment) || fallback
  } catch {
    return segment || fallback
  }
}

/** 选择并读取 UTF-8 文本文件：Web 用隐藏 input，Tauri 用原生对话框 + fs */
export const pickTextFile = async (options: {
  accept: string
  extensions: string[]
}): Promise<{ name: string; text: string } | null> => {
  if (!isTauri()) {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = options.accept
      input.style.display = 'none'
      const finish = (file: File | null) => {
        input.remove()
        if (!file) {
          resolve(null)
          return
        }
        void file.text().then(
          (text) => resolve({ name: file.name, text }),
          () => resolve(null)
        )
      }
      input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
      input.addEventListener('cancel', () => finish(null), { once: true })
      document.body.appendChild(input)
      input.click()
    })
  }

  const [{ open }, { readTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: options.extensions.join('/').toUpperCase(), extensions: options.extensions }],
  })
  const path = Array.isArray(selected) ? selected[0] : selected
  if (!path) {
    return null
  }
  const text = await readTextFile(path)
  return { name: fileNameFromPath(path, ''), text }
}

/** 保存任意 Blob：Tauri 走系统保存对话框和 fs，Web 走浏览器下载。 */
export const saveBlobFile = async (
  blob: Blob,
  name: string,
  kind: 'archive' | 'file' = 'file'
): Promise<SaveBlobResult> => {
  if (!isTauri()) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { status: 'saved' }
  }

  try {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    // Android 的文件选择器按 MIME 过滤，桌面按扩展名过滤。
    const filters =
      kind === 'archive' && isAndroid()
        ? [{ name: 'ZIP', extensions: ['application/zip'] }]
        : kind === 'archive'
          ? [FILE_FILTERS[0]]
          : undefined
    const path = await save({ defaultPath: name, filters })
    if (!path) {
      return { status: 'canceled' }
    }
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return { status: 'saved' }
  } catch (error) {
    return { status: 'failed', error }
  }
}

/** 选择历史归档；Tauri 使用原生文件对话框并把文件复制进应用沙箱。 */
export const pickArchiveFile = async (): Promise<File | null> => {
  if (!isTauri()) {
    return new Promise<File | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.zip,application/zip,application/x-zip-compressed'
      input.style.display = 'none'
      const finish = (file: File | null) => {
        input.remove()
        resolve(file)
      }
      input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
      input.addEventListener('cancel', () => finish(null), { once: true })
      document.body.appendChild(input)
      input.click()
    })
  }

  const [{ open }, { readFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const selected = await open({
    multiple: false,
    directory: false,
    filters: isAndroid() ? [{ name: 'ZIP', extensions: ['application/zip'] }] : [FILE_FILTERS[0]],
  })
  const path = Array.isArray(selected) ? selected[0] : selected
  if (!path) {
    return null
  }
  const bytes = await readFile(path)
  return new File([bytes], fileNameFromPath(path), { type: 'application/zip' })
}

/** 打开消息里的原件：Tauri 保存到用户选择的位置，Web 保持 PDF 预览/下载。 */
export const openAttachmentBlob = async (
  blob: Blob,
  url: string,
  name: string,
  type: string
): Promise<SaveBlobResult> => {
  if (!isTauri() && type === 'application/pdf') {
    window.open(url, '_blank', 'noopener,noreferrer')
    return { status: 'saved' }
  }
  return saveBlobFile(blob, name)
}
