/**
 * 图标层：全部使用 lucide-react。
 *
 * 导出的名字沿用 kv/旧版命名（`IconCheckOutline16` 之类），调用点不需要改；名字里的数字
 * 是官方图标的原始尺寸，作为默认 size。新界面需要尺寸时直接传 `size`。
 */

import type { ReactElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowUp,
  ArrowUpRight,
  Atom,
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleExclamationPoint,
  CirclePlus,
  CircleQuestionMark,
  Copy,
  Database,
  Download,
  Ellipsis,
  EllipsisVertical,
  FileText,
  FileUp,
  Globe,
  GlobeOff,
  Image as ImageGlyph,
  ImageOff,
  Info as InfoGlyph,
  KeyRound,
  Languages,
  Link as LinkGlyph,
  ListChecks,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCirclePlus,
  Mic,
  MonitorSmartphone,
  Moon,
  Palette,
  PanelLeftClose,
  Paperclip,
  PencilLine,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  Search,
  SearchX,
  Settings as SettingsGlyph,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Trash,
  TriangleExclamationPoint,
  Type as TypeGlyph,
  Upload,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react'

export type IconProps = {
  size?: number
  className?: string
  strokeWidth?: number
}

type LucideProps = IconProps & { defaultSize: number; defaultStroke?: number }

type IconComponent = ((props: IconProps) => ReactElement) & { displayName?: string }

const base = ({ size, defaultSize, className, strokeWidth }: LucideProps) => ({
  size: size ?? defaultSize,
  strokeWidth: strokeWidth ?? 1.75,
  className,
  'aria-hidden': true,
})

/** 生成一个固定默认尺寸的图标组件，保留 lucide 的描边风格 */
const icon = (Glyph: LucideIcon, defaultSize: number): IconComponent => {
  const Component = (props: IconProps) => <Glyph {...base({ ...props, defaultSize })} />
  Component.displayName = `LucideIcon(${defaultSize})`
  return Component
}

/* ---- 沿用旧名字的图标 ---- */

export const IconCheckOutline16 = icon(Check, 16)
export const IconChevronDownOutline14 = icon(ChevronDown, 14)
export const IconChevronRightOutline14 = icon(ChevronRight, 14)
export const IconCloseFill14 = icon(X, 14)
export const IconCloseOutline16 = icon(X, 16)
export const IconCopyOutline16 = icon(Copy, 16)
export const IconDarkOutline16 = icon(Moon, 16)
export const IconDataOutline16 = icon(Database, 16)
export const IconUploadOutline14 = icon(Upload, 14)
export const IconDownloadOutline16 = icon(Download, 16)
export const IconEditOutline16 = icon(PencilLine, 16)
export const IconEllipsisOutline16 = icon(Ellipsis, 16)
export const IconFollowsystemOutline16 = icon(MonitorSmartphone, 16)
export const IconLightOutline16 = icon(Sun, 16)
export const IconLinkOutline14 = icon(LinkGlyph, 14)
export const IconLinkOutline16 = icon(LinkGlyph, 16)
export const IconLoadingOutline16 = (props: IconProps) => (
  <LoaderCircle
    {...base({ ...props, defaultSize: 16 })}
    className={props.className ? `${props.className} ds-icon-spin` : 'ds-icon-spin'}
  />
)
export const IconMenuOutline20 = icon(Menu, 20)
export const IconNewChatOutline20 = icon(CirclePlus, 20)
export const IconPanelLeftOutline16 = icon(PanelLeftClose, 16)
export const IconPaperclipOutline16 = icon(Paperclip, 16)
export const IconRefreshOutline16 = icon(RotateCcw, 16)
export const IconSendOutline16 = icon(ArrowUp, 16)
export const IconSettingsOutline16 = icon(SettingsGlyph, 16)
export const IconStopFill16 = icon(Square, 16)
export const IconToolOutline16 = icon(Wrench, 16)
export const IconThinkOutline14 = icon(Atom, 14)
export const IconThinkOutline16 = icon(Atom, 16)
export const IconTrashOutline16 = icon(Trash, 16)
export const IconWarningOutline16 = icon(TriangleExclamationPoint, 16)
export const IconBrowseOutline16 = icon(Globe, 16)
/** 智能搜索开关上的地球：官方输入条用的是 globe，不是语言图标 */
export const IconGlobeOutline16 = icon(Globe, 16)
export const IconBrowseWarningOutline16 = icon(GlobeOff, 16)
export const IconCheckedOutline14 = icon(Check, 14)
export const IconRightUpOutline14 = icon(ArrowUpRight, 14)
export const IconSearchOutline16 = icon(Search, 16)
export const IconSearchWarningOutline16 = icon(SearchX, 16)
export const IconMicOutline16 = icon(Mic, 16)
export const IconMicFill16 = icon(AudioLines, 16)
export const IconPlayMediaOutline16 = icon(Volume2, 16)
export const IconPhotoErrorFill20 = icon(ImageOff, 20)
export const IconToastError16 = icon(CircleExclamationPoint, 16)
export const NewChatIcon = icon(MessageCirclePlus, 16)

/* ---- 官方移动端界面新增的图标 ---- */

export const IconMenu24 = icon(Menu, 24)
export const IconNewChatCircle24 = icon(CirclePlus, 24)
export const IconSpeakerOff24 = icon(VolumeX, 22)
export const IconSpeakerOn24 = icon(Volume2, 22)
export const IconSliders20 = icon(SlidersHorizontal, 20)
export const IconPin20 = icon(Pin, 20)
export const IconPinOff20 = icon(PinOff, 20)
export const IconPencil20 = icon(PencilLine, 20)
export const IconListChecks20 = icon(ListChecks, 20)
export const IconChevronLeft20 = icon(ChevronLeft, 20)
export const IconChevronRight20 = icon(ChevronRight, 20)
export const IconChevronDown20 = icon(ChevronDown, 20)
export const IconSearch20 = icon(Search, 20)
export const IconGlobe20 = icon(Globe, 20)
export const IconAtom20 = icon(Atom, 20)
export const IconArrowUp20 = icon(ArrowUp, 20)
export const IconEllipsisV20 = icon(EllipsisVertical, 20)
export const IconCamera24 = icon(Camera, 24)
export const IconAlbum24 = icon(ImageGlyph, 24)
export const IconFileUp24 = icon(FileUp, 24)
export const IconTrash20 = icon(Trash, 20)
export const IconCheck20 = icon(Check, 20)
export const IconLogOut20 = icon(LogOut, 20)
export const IconInfo20 = icon(InfoGlyph, 20)
export const IconFileText20 = icon(FileText, 20)
export const IconPalette20 = icon(Palette, 20)
export const IconLanguages20 = icon(Languages, 20)
export const IconDatabase20 = icon(Database, 20)
export const IconDownload20 = icon(Download, 20)
export const IconUpload20 = icon(Upload, 20)
export const IconMoon20 = icon(Moon, 20)
export const IconSun20 = icon(Sun, 20)
export const IconMonitorSmartphone20 = icon(MonitorSmartphone, 20)
export const IconPlay20 = icon(Play, 20)
export const IconSearch24 = icon(Search, 24)
export const IconMic20 = icon(Mic, 20)
export const IconSquare20 = icon(Square, 20)
export const IconType20 = icon(TypeGlyph, 20)
export const IconSparkles20 = icon(Sparkles, 20)
export const IconKey20 = icon(KeyRound, 20)
export const IconHelp20 = icon(CircleQuestionMark, 20)
