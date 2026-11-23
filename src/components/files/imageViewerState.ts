import { create } from 'zustand'

type ImageViewerState = {
  url: string | null
  name: string
  open: (url: string, name: string) => void
  close: () => void
}

/** 全屏图片预览：消息切换或返回键时关闭。 */
export const useImageViewer = create<ImageViewerState>((set) => ({
  url: null,
  name: '',
  open: (url, name) => set({ url, name }),
  close: () => set({ url: null, name: '' }),
}))

export const openImageViewer = (url: string, name: string) =>
  useImageViewer.getState().open(url, name)

export const closeImageViewer = () => useImageViewer.getState().close()
